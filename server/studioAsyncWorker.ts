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
 *
 * Cancel-safety (T1.4): Two atomic CAS helpers (`completeJobIfProcessing`, `failJobIfClaimable`)
 * gate all terminal writes. The deadline path calls failJobIfClaimable — if the op already
 * completed and flipped to `done`, the CAS loses (affectedRows=0) and the refund is skipped.
 * Conversely, if the deadline fires first, completeJobIfProcessing loses and the late result is
 * discarded. This prevents the deliver-AND-refund double-resolve hazard.
 */
import { ENV } from "./_core/env";
import { finishSam2Segmentation } from "./_core/masking/sam2Provider";
import { defaultSam2Client, type Sam2Client } from "./_core/masking/replicateSam2";
import { runDensityOnSegmentation, runScaleOnSegmentation } from "./aiEngine";
import { storagePut, storageGetSignedUrl } from "./storage";
import { getJob, updateJobStatus, addVariation, grantCredits, claimJobForCpuProcessing, completeJobIfProcessing, failJobIfClaimable, incrementPollAttempts } from "./studioDb";
import { log } from "./serverLog";
import { emitRefundTelemetry } from "./refundTelemetry";
import { REFUND_REASONS, type RefundReason } from "../shared/refundReasons";
import { type ControlSettings, resolveDensityRedistribute } from "../shared/controls";

export type AsyncJobOutcome = { status: "done" | "failed" | "pending" | "skipped"; reason?: string };

/**
 * T1.4: Worker deadline — 45s (safe below the 60s cron execution cap).
 * The poll-predictions cron runs the op inside the Manus ~60s execution cap
 * (listSam2ProcessingJobs processes N=1 to fit it); a CPU op that outruns the cap is
 * hard-killed mid-run and stranded. Race the op against a deadline BELOW the cap so a
 * slow job fails+refunds via failJobIfClaimable instead of stranding.
 */
const WORKER_DEADLINE_MS = 45_000;

/** Exported for tests to override. */
export function getDeadlineMs(): number {
  return ENV.studioWorkerDeadlineMs ?? WORKER_DEADLINE_MS;
}

/** `client` injectable for tests; defaults to the production Replicate client. */
export async function processAsyncJob(
  jobId: number,
  client: Sam2Client = defaultSam2Client(),
  deadlineMs: number = getDeadlineMs()
): Promise<AsyncJobOutcome> {
  const job = await getJob(jobId);
  if (!job) return { status: "skipped", reason: "job not found" };
  if (job.status === "done" || job.status === "failed") return { status: "skipped", reason: `already ${job.status}` };
  if (!job.predictionId || !job.predictionMeta) return { status: "skipped", reason: "no predictionId/meta" };

  // T1.3: Poison-pill cap. A wedged prediction would re-poll until the 10-min reaper, burning
  // API calls. Fire only once the job is BOTH past the poll cap AND aged past the max expected
  // prediction lifetime (> the ~120s SAM2 run timeout) — so a slow-but-healthy prediction at the
  // ~10s poll cadence isn't false-failed + refunded while still validly running. enqueuedAt is
  // immutable; poll count alone at a 10s cadence would trip at ~50s.
  const MAX_POLL_ATTEMPTS = ENV.studioMaxPollAttempts;
  const attempts = await incrementPollAttempts(job.id);
  const ageMs = job.enqueuedAt ? Date.now() - new Date(job.enqueuedAt).getTime() : 0;
  if (attempts >= MAX_POLL_ATTEMPTS && ageMs >= ENV.studioMaxPredictionAgeMs) {
    log.warn("studio", `async-worker: poison-pill (${attempts} polls, age ${Math.round(ageMs / 1000)}s)`, { jobId: job.id, tenantId: job.tenantId });
    const cost = job.creditsUsed ?? 0;
    const poisonRefId = job.predictionMeta?.deductRef
      ? `${job.predictionMeta.deductRef}-failed`
      : `job-${job.id}-failed`;
    try {
      if (cost > 0) await grantCredits(job.tenantId, cost, "refund", poisonRefId, job.userId);
    } catch (e) {
      log.error("studio", "async-worker: poison-pill refund failed", { jobId: job.id, metadata: { error: (e as any)?.message || String(e) } });
    }
    await updateJobStatus(job.id, "failed", { errorMessage: `Poison-pill: ${attempts} polls over ${Math.round(ageMs / 1000)}s — prediction never completed` }).catch(() => {});
    emitRefundTelemetry({
      reason: REFUND_REASONS.poison_pill,
      jobId: job.id,
      tenantId: job.tenantId,
      userId: job.userId,
      credits: cost,
      detail: `${attempts} polls over ${Math.round(ageMs / 1000)}s — prediction never completed.`,
    });
    return { status: "failed", reason: `poison-pill: ${attempts} polls, ${Math.round(ageMs / 1000)}s` };
  }

  const cost = job.creditsUsed ?? 0;
  const refundRefId = job.predictionMeta?.deductRef
    ? `${job.predictionMeta.deductRef}-failed`
    : `job-${job.id}-failed`;

  /**
   * Cancel-safe fail+refund. Uses `failJobIfClaimable` CAS: only refunds if the job is
   * still in-flight (sam2_processing or cpu_processing). If the success path already
   * flipped to `done`, the CAS loses and no refund is issued — preventing deliver-AND-refund.
   */
  const failAndRefund = async (refundReason: RefundReason, detail: string): Promise<AsyncJobOutcome> => {
    const claimed = await failJobIfClaimable(job.id, detail);
    if (!claimed) {
      // Job already finalized (done by success path, or failed by peer/reaper) — skip refund.
      log.warn("studio", "async-worker: failAndRefund CAS lost — job already finalized", { jobId: job.id, metadata: { refundRefId } });
      return { status: "skipped", reason: "job already finalized before fail" };
    }
    try {
      if (cost > 0) await grantCredits(job.tenantId, cost, "refund", refundRefId, job.userId);
    } catch (e) {
      log.error("studio", "async-worker: refund failed", { jobId: job.id, tenantId: job.tenantId, metadata: { cost, error: (e as any)?.message || String(e) } });
    }
    // T0.1: Emit per-guard refund telemetry — exactly one reason per refund event.
    emitRefundTelemetry({
      reason: refundReason,
      jobId: job.id,
      tenantId: job.tenantId,
      userId: job.userId,
      credits: cost,
      detail,
    });
    return { status: "failed", reason: detail };
  };

  // The op body. Always RESOLVES (never rejects): internal degrades/errors route to
  // failAndRefund. Raced against the deadline below.
  const runJob = async (): Promise<AsyncJobOutcome> => {
    try {
      const result = await client.processPrediction(job.predictionId!);
      if (result.status === "processing") return { status: "pending", reason: "prediction still running" };
      if (result.status === "failed") {
        return failAndRefund(REFUND_REASONS.sam2_error, `SAM2 prediction failed: ${result.error}`);
      }

      // succeeded — atomically claim so only ONE worker runs the op + writes the variation.
      const claimed = await claimJobForCpuProcessing(job.id);
      if (!claimed) return { status: "skipped", reason: "claimed by another worker" };

      const controls = job.controls ? (JSON.parse(job.controls) as ControlSettings) : null;
      if (!controls) {
        return failAndRefund(REFUND_REASONS.missing_controls, "missing controls");
      }

      const srcUrl = job.originalUrl.startsWith("/manus-storage/")
        ? await storageGetSignedUrl(job.originalUrl.replace("/manus-storage/", ""))
        : job.originalUrl;

      const { fabric, instances } = await finishSam2Segmentation(result.segmentation, job.predictionMeta!);

      let png: Buffer;
      if (controls.density?.enabled) {
        // v2 (respace) vs v1 (thin in place) per the user's chosen mode, gated by the
        // redistribute flag (respace only runs when flipped live — §3 flip authority).
        const redistribute = resolveDensityRedistribute(controls.density.mode, ENV.studioDensityRedistribute);
        const out = await runDensityOnSegmentation(srcUrl, fabric, instances, controls.density.percent, redistribute);
        if (!out) {
          return failAndRefund(REFUND_REASONS.round0_noop, "density no-op (removed 0)");
        }
        png = out.png;
      } else if (controls.scale?.enabled && controls.scale.percent !== 0) {
        png = await runScaleOnSegmentation(srcUrl, fabric, (100 + controls.scale.percent) / 100);
      } else {
        return failAndRefund(REFUND_REASONS.no_async_op, "no async-supported op in controls");
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
      return failAndRefund(
        classifyError((err as any)?.message || ""),
        (err as any)?.message || "async generation failed"
      );
    }
  };

  // T1.4: In-worker wall-clock deadline via Promise.race.
  if (!(deadlineMs > 0)) return runJob();
  let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    deadlineTimer = setTimeout(() => reject(new Error(`WORKER_DEADLINE_EXCEEDED`)), deadlineMs);
  });
  try {
    return await Promise.race([runJob(), deadline]);
  } catch (err) {
    const errMsg = (err as any)?.message || "async generation failed";
    if (errMsg === "WORKER_DEADLINE_EXCEEDED") {
      log.warn("studio", `async-worker: deadline exceeded (${deadlineMs}ms)`, { jobId: job.id });
      return failAndRefund(REFUND_REASONS.deadline, `Worker deadline exceeded (${deadlineMs}ms)`);
    }
    return failAndRefund(classifyError(errMsg), errMsg);
  } finally {
    if (deadlineTimer) clearTimeout(deadlineTimer);
  }
}

/** Classify error messages into refund reasons for telemetry. */
function classifyError(msg: string): RefundReason {
  if (msg.includes("NON_REPEAT_SCALE_ERROR") || msg.includes("non-repeat")) return REFUND_REASONS.non_repeat;
  if (msg.includes("NO_OP_SCALE_ERROR") || msg.includes("no-op")) return REFUND_REASONS.round0_noop;
  if (msg.includes("boundary") && msg.includes("dimension")) return REFUND_REASONS.boundary_dims;
  if (msg.includes("raster") && msg.includes("dimension")) return REFUND_REASONS.raster_dims;
  if (msg.includes("instance") && msg.includes("dimension")) return REFUND_REASONS.instance_dims;
  if (msg.includes("under-segmented") || msg.includes("too few")) return REFUND_REASONS.under_seg;
  return REFUND_REASONS.degrade_other;
}
