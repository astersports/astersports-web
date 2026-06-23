/**
 * Async generation worker (ASYNC_GENERATION_SPEC §4) — the SINGLE idempotent function the
 * Replicate webhook AND the cron poller both call. Resolves a started SAM2 prediction and, on
 * success, runs the deterministic op + saves the result; on failure / degrade / no-op, issues the
 * idempotent ledger refund + marks the job `failed`. The whole body is try/catch-wrapped so ANY
 * throw still refunds (CLAUDE.md §1 — never bill for a no-op / a job that produced nothing).
 *
 * Concurrency: webhook + cron can fire for the same job. The atomic claim
 * (sam2_processing -> cpu_processing) lets only one worker run the op + write the variation; the
 * other no-ops. grantCredits is idempotent on (refId, reason) as a second backstop against a
 * double refund, and the reaper backstops a worker/container death mid-op.
 */
import { ENV } from "./_core/env";
import { finishSam2Segmentation } from "./_core/masking/sam2Provider";
import { defaultSam2Client, type Sam2Client } from "./_core/masking/replicateSam2";
import { runDensityOnSegmentation, runScaleOnSegmentation } from "./aiEngine";
import { storagePut, storageGetSignedUrl } from "./storage";
import { getJob, addVariation, grantCredits, claimJobForCpuProcessing, completeJobIfProcessing, failJobIfClaimable } from "./studioDb";
import { log } from "./serverLog";
import { type ControlSettings } from "../shared/controls";

export type AsyncJobOutcome = { status: "done" | "failed" | "pending" | "skipped"; reason?: string };

/** `client` injectable for tests; defaults to the production Replicate client. `deadlineMs` is
 *  the in-worker wall-clock budget (default ENV.studioWorkerDeadlineMs ~45s, below the Manus ~60s
 *  cron execution cap); injectable so tests can drive the deadline path deterministically. */
export async function processAsyncJob(
  jobId: number,
  client: Sam2Client = defaultSam2Client(),
  deadlineMs: number = ENV.studioWorkerDeadlineMs,
): Promise<AsyncJobOutcome> {
  const job = await getJob(jobId);
  if (!job) return { status: "skipped", reason: "job not found" };
  if (job.status === "done" || job.status === "failed") return { status: "skipped", reason: `already ${job.status}` };
  if (!job.predictionId || !job.predictionMeta) return { status: "skipped", reason: "no predictionId/meta" };

  const cost = job.creditsUsed ?? 0;
  // Refund the EXACT attempt that was debited: the enqueue mutation records the
  // per-attempt deduct refId (`job-<id>-a<N>`) on predictionMeta, so we refund
  // `<deductRef>-failed`. A fixed `job-<id>-failed` collided across regenerate
  // attempts (attempt 2's refund no-ops against attempt 1's key, leaving attempt 2
  // un-refunded). Fallback to the legacy key for jobs enqueued before this field.
  // Either form still starts with `job-<id>-` so the reaper's `job-<id>-%` guard
  // prevents a double refund across webhook/cron/reaper; idempotent on (refId,reason).
  const refundRefId = job.predictionMeta?.deductRef
    ? `${job.predictionMeta.deductRef}-failed`
    : `job-${job.id}-failed`;
  // Fail+refund, GATED on atomically claiming the failed transition (failJobIfClaimable).
  // If the success path already finalized the job as `done` (op beat the deadline) or a
  // peer/reaper already failed it, the CAS loses and we SKIP the refund — so a delivered+
  // billed job is never refunded and no double-refund is issued. grantCredits stays
  // idempotent on (refId,reason) as a second backstop. Pre-claim failures (status still
  // sam2_processing) win the CAS too, so they still refund.
  const failAndRefund = async (reason: string): Promise<AsyncJobOutcome> => {
    const won = await failJobIfClaimable(job.id, reason);
    if (!won) {
      log.warn("studio", "async-worker: fail/refund skipped — job already finalized", { jobId: job.id, metadata: { reason, refundRefId } });
      return { status: "skipped", reason: `already finalized: ${reason}` };
    }
    try {
      if (cost > 0) await grantCredits(job.tenantId, cost, "refund", refundRefId, job.userId);
    } catch (e) {
      log.error("studio", "async-worker: refund failed", { jobId: job.id, tenantId: job.tenantId, metadata: { cost, error: (e as any)?.message || String(e) } });
    }
    // Telemetry: async failures previously only console.warn'd, so refund/no-op rate
    // was invisible to server_logs / notifyOwner. Surface every fail+refund explicitly.
    log.warn("studio", "async-worker: job failed + refunded", {
      jobId: job.id,
      tenantId: job.tenantId,
      metadata: { reason, cost, refundRefId },
    });
    return { status: "failed", reason };
  };

  // The op body. Always RESOLVES (never rejects): internal degrades/errors route to
  // failAndRefund. Raced against the deadline below.
  const runJob = async (): Promise<AsyncJobOutcome> => {
    try {
      const result = await client.processPrediction(job.predictionId!);
      if (result.status === "processing") return { status: "pending", reason: "prediction still running" };
      if (result.status === "failed") return failAndRefund(`SAM2 prediction failed: ${result.error}`);

      // succeeded — atomically claim so only ONE worker runs the op + writes the variation.
      const claimed = await claimJobForCpuProcessing(job.id);
      if (!claimed) return { status: "skipped", reason: "claimed by another worker" };

      const controls = job.controls ? (JSON.parse(job.controls) as ControlSettings) : null;
      if (!controls) return failAndRefund("missing controls");

      const srcUrl = job.originalUrl.startsWith("/manus-storage/")
        ? await storageGetSignedUrl(job.originalUrl.replace("/manus-storage/", ""))
        : job.originalUrl;

      const { fabric, instances } = await finishSam2Segmentation(result.segmentation, job.predictionMeta!);

      let png: Buffer;
      if (controls.density?.enabled) {
        const out = await runDensityOnSegmentation(srcUrl, fabric, instances, controls.density.percent, ENV.studioDensityRedistribute);
        if (!out) return failAndRefund("density no-op (removed 0)");
        png = out.png;
      } else if (controls.scale?.enabled && controls.scale.percent !== 0) {
        // runScaleOnSegmentation throws NO_OP_SCALE_ERROR / NON_REPEAT_SCALE_ERROR -> caught below -> refund.
        png = await runScaleOnSegmentation(srcUrl, fabric, (100 + controls.scale.percent) / 100);
      } else {
        return failAndRefund("no async-supported op in controls");
      }

      const key = `studio/${job.tenantId}/${job.id}/async-1.png`;
      const { url } = await storagePut(key, png, "image/png");
      // Cancel-safe finalize: atomically flip cpu_processing -> done. If the deadline (or a
      // peer) already finalized this job as failed+refunded, we LOSE the CAS — discard the
      // late result rather than deliver-and-refund. (storagePut above may leave an orphan
      // blob in that rare tie; harmless — no variation references it, no ledger effect.)
      const finalized = await completeJobIfProcessing(job.id, cost);
      if (!finalized) {
        log.warn("studio", "async-worker: result discarded — job finalized (deadline/peer) before op completed", { jobId: job.id, metadata: { refundRefId } });
        return { status: "skipped", reason: "finalized before op completed" };
      }
      await addVariation({ jobId: job.id, tenantId: job.tenantId, resultKey: key, resultUrl: url, round: 1 });
      return { status: "done" };
    } catch (err) {
      return failAndRefund((err as any)?.message || "async generation failed");
    }
  };

  // In-worker wall-clock deadline. The poll-predictions cron runs the op inside the Manus
  // ~60s execution cap (listSam2ProcessingJobs processes N=1 to fit it); a CPU op that
  // outruns the cap is hard-killed mid-run and stranded — the client reads it as a "timeout"
  // and the charge sits until the reaper sweeps. Race the op against a deadline BELOW the cap
  // so a slow job fails+refunds via failAndRefund instead of stranding. (The timer fires at
  // the next event-loop yield; the op yields at every await/sharp boundary, and a single
  // unbroken sync block is bounded by the container cap itself.)
  if (!(deadlineMs > 0)) return runJob();
  let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    deadlineTimer = setTimeout(() => reject(new Error(`worker deadline exceeded (${deadlineMs}ms)`)), deadlineMs);
  });
  try {
    return await Promise.race([runJob(), deadline]);
  } catch (err) {
    return await failAndRefund((err as any)?.message || "async generation failed");
  } finally {
    if (deadlineTimer) clearTimeout(deadlineTimer);
  }
}
