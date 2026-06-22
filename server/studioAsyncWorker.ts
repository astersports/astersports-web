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
import { getJob, updateJobStatus, addVariation, grantCredits, claimJobForCpuProcessing } from "./studioDb";
import { log } from "./serverLog";
import { type ControlSettings } from "../shared/controls";

export type AsyncJobOutcome = { status: "done" | "failed" | "pending" | "skipped"; reason?: string };

/** `client` injectable for tests; defaults to the production Replicate client. */
export async function processAsyncJob(jobId: number, client: Sam2Client = defaultSam2Client()): Promise<AsyncJobOutcome> {
  const job = await getJob(jobId);
  if (!job) return { status: "skipped", reason: "job not found" };
  if (job.status === "done" || job.status === "failed") return { status: "skipped", reason: `already ${job.status}` };
  if (!job.predictionId || !job.predictionMeta) return { status: "skipped", reason: "no predictionId/meta" };

  const cost = job.creditsUsed ?? 0;
  // Per-job fixed refId (one prediction per job in the async model). Idempotent on (refId,reason)
  // and matched by the reaper's `job-<id>-%` guard, so no double refund across webhook/cron/reaper.
  const refundRefId = `job-${job.id}-failed`;
  const failAndRefund = async (reason: string): Promise<AsyncJobOutcome> => {
    try {
      if (cost > 0) await grantCredits(job.tenantId, cost, "refund", refundRefId, job.userId);
    } catch (e) {
      log.error("studio", "async-worker: refund failed", { jobId: job.id, tenantId: job.tenantId, metadata: { cost, error: (e as any)?.message || String(e) } });
    }
    await updateJobStatus(job.id, "failed", { errorMessage: reason }).catch(() => {});
    return { status: "failed", reason };
  };

  try {
    const result = await client.processPrediction(job.predictionId);
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

    const { fabric, instances } = await finishSam2Segmentation(result.segmentation, job.predictionMeta);

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
    await addVariation({ jobId: job.id, tenantId: job.tenantId, resultKey: key, resultUrl: url, round: 1 });
    await updateJobStatus(job.id, "done", { creditsUsed: cost });
    return { status: "done" };
  } catch (err) {
    return failAndRefund((err as any)?.message || "async generation failed");
  }
}
