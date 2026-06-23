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
import { getJob, updateJobStatus, addVariation, grantCredits, claimJobForCpuProcessing, incrementPollAttempts } from "./studioDb";
import { log } from "./serverLog";
import { emitRefundTelemetry } from "./refundTelemetry";
import { REFUND_REASONS, type RefundReason } from "../shared/refundReasons";
import { type ControlSettings } from "../shared/controls";

export type AsyncJobOutcome = { status: "done" | "failed" | "pending" | "skipped"; reason?: string };

/**
 * T1.4: Worker deadline — 45s (safe below the 60s cron execution cap).
 * Wraps the job body in AbortController + Promise.race so a hung job is terminated internally
 * rather than waiting for the 10-min reaper. The AbortSignal is threaded into network calls
 * so the timeout *cancels* rather than leaks. A `terminated` flag guards terminal writes so
 * a late-completing body cannot mark a deadline-failed job `done` (no double-resolution).
 *
 * Note: The platform HTTP cap is 180s, but the cron poller path (poll-predictions) has a
 * tighter 60s execution window. Since processAsyncJob is called from the cron handler,
 * the deadline must fit within that window with margin for cleanup.
 */
const WORKER_DEADLINE_MS = 45_000;

/** `client` injectable for tests; defaults to the production Replicate client. */
export async function processAsyncJob(jobId: number, client: Sam2Client = defaultSam2Client()): Promise<AsyncJobOutcome> {
  const job = await getJob(jobId);
  if (!job) return { status: "skipped", reason: "job not found" };
  if (job.status === "done" || job.status === "failed") return { status: "skipped", reason: `already ${job.status}` };
  if (!job.predictionId || !job.predictionMeta) return { status: "skipped", reason: "no predictionId/meta" };

  // T1.3: Poison-pill max-attempt cap. Increment poll count; at >= MAX_POLL_ATTEMPTS
  // the job is terminal — it will never complete (wedged prediction). Refund immediately
  // instead of burning API calls until the reaper catches it 10 min later.
  const MAX_POLL_ATTEMPTS = 5;
  const attempts = await incrementPollAttempts(job.id);
  if (attempts >= MAX_POLL_ATTEMPTS) {
    log.warn("studio", `async-worker: poison-pill cap reached (${attempts} attempts)`, { jobId: job.id, tenantId: job.tenantId });
    const cost = job.creditsUsed ?? 0;
    const poisonRefId = job.predictionMeta?.deductRef
      ? `${job.predictionMeta.deductRef}-failed`
      : `job-${job.id}-failed`;
    try {
      if (cost > 0) await grantCredits(job.tenantId, cost, "refund", poisonRefId, job.userId);
    } catch (e) {
      log.error("studio", "async-worker: poison-pill refund failed", { jobId: job.id, metadata: { error: (e as any)?.message || String(e) } });
    }
    await updateJobStatus(job.id, "failed", { errorMessage: `Poison-pill: exceeded ${MAX_POLL_ATTEMPTS} poll attempts` }).catch(() => {});
    emitRefundTelemetry({
      reason: REFUND_REASONS.poison_pill,
      jobId: job.id,
      tenantId: job.tenantId,
      userId: job.userId,
      credits: cost,
      detail: `Exceeded ${MAX_POLL_ATTEMPTS} poll attempts — prediction never completed.`,
    });
    return { status: "failed", reason: `poison-pill: ${attempts} attempts` };
  }

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

  // T1.4: Monotonic terminal state flag. Once set, no late-completing body can write
  // a terminal state (done/failed). Prevents the race: deadline fires → refund → late
  // body completes → tries to mark done → blocked by this flag.
  let terminated = false;

  const failAndRefund = async (refundReason: RefundReason, detail: string): Promise<AsyncJobOutcome> => {
    if (terminated) return { status: "failed", reason: "already terminated (deadline)" };
    terminated = true;
    try {
      if (cost > 0) await grantCredits(job.tenantId, cost, "refund", refundRefId, job.userId);
    } catch (e) {
      log.error("studio", "async-worker: refund failed", { jobId: job.id, tenantId: job.tenantId, metadata: { cost, error: (e as any)?.message || String(e) } });
    }
    await updateJobStatus(job.id, "failed", { errorMessage: detail }).catch(() => {});
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

  // T1.4: AbortController for the deadline. The signal is available for network calls
  // to abort cleanly when the deadline fires.
  const ac = new AbortController();
  const deadlineTimer = setTimeout(() => ac.abort(), WORKER_DEADLINE_MS);

  // The job body — runs the prediction poll + CPU op + persist.
  const runBody = async (): Promise<AsyncJobOutcome> => {
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
      const out = await runDensityOnSegmentation(srcUrl, fabric, instances, controls.density.percent, ENV.studioDensityRedistribute);
      if (!out) {
        return failAndRefund(REFUND_REASONS.round0_noop, "density no-op (removed 0)");
      }
      png = out.png;
    } else if (controls.scale?.enabled && controls.scale.percent !== 0) {
      // runScaleOnSegmentation throws NO_OP_SCALE_ERROR / NON_REPEAT_SCALE_ERROR -> caught below -> refund.
      png = await runScaleOnSegmentation(srcUrl, fabric, (100 + controls.scale.percent) / 100);
    } else {
      return failAndRefund(REFUND_REASONS.no_async_op, "no async-supported op in controls");
    }

    // Guard: if deadline already fired while we were computing, don't overwrite the failed state.
    if (terminated) return { status: "failed", reason: "deadline fired during op — not persisting" };

    const key = `studio/${job.tenantId}/${job.id}/async-1.png`;
    const { url } = await storagePut(key, png, "image/png");
    await addVariation({ jobId: job.id, tenantId: job.tenantId, resultKey: key, resultUrl: url, round: 1 });

    // Final terminal-state guard before marking done.
    if (terminated) return { status: "failed", reason: "deadline fired after persist — not marking done" };
    terminated = true;
    await updateJobStatus(job.id, "done", { creditsUsed: cost });
    return { status: "done" };
  };

  try {
    // T1.4: Promise.race — body vs deadline. The deadline promise rejects with an
    // AbortError when the timer fires; the body may also throw on its own.
    const deadlinePromise = new Promise<never>((_, reject) => {
      ac.signal.addEventListener("abort", () => {
        reject(new Error("WORKER_DEADLINE_EXCEEDED"));
      }, { once: true });
    });

    const outcome = await Promise.race([runBody(), deadlinePromise]);
    clearTimeout(deadlineTimer);
    return outcome;
  } catch (err) {
    clearTimeout(deadlineTimer);
    const errMsg = (err as any)?.message || "async generation failed";

    // T1.4: Deadline-specific handling.
    if (errMsg === "WORKER_DEADLINE_EXCEEDED") {
      log.warn("studio", `async-worker: deadline exceeded (${WORKER_DEADLINE_MS}ms)`, { jobId: job.id });
      return failAndRefund(REFUND_REASONS.deadline, `Worker deadline exceeded (${WORKER_DEADLINE_MS}ms)`);
    }

    // Classify the error into a refund reason based on known error patterns.
    let reason: RefundReason = REFUND_REASONS.degrade_other;
    if (errMsg.includes("NON_REPEAT_SCALE_ERROR") || errMsg.includes("non-repeat")) {
      reason = REFUND_REASONS.non_repeat;
    } else if (errMsg.includes("NO_OP_SCALE_ERROR") || errMsg.includes("no-op")) {
      reason = REFUND_REASONS.round0_noop;
    } else if (errMsg.includes("boundary") && errMsg.includes("dimension")) {
      reason = REFUND_REASONS.boundary_dims;
    } else if (errMsg.includes("raster") && errMsg.includes("dimension")) {
      reason = REFUND_REASONS.raster_dims;
    } else if (errMsg.includes("instance") && errMsg.includes("dimension")) {
      reason = REFUND_REASONS.instance_dims;
    } else if (errMsg.includes("under-segmented") || errMsg.includes("too few")) {
      reason = REFUND_REASONS.under_seg;
    }
    return failAndRefund(reason, errMsg);
  }
}
