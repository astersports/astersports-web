/**
 * POST /api/webhooks/replicate (ASYNC_GENERATION_SPEC §3).
 *
 * FAIL-CLOSED: verify the svix-style HMAC signature against REPLICATE_WEBHOOK_SECRET over the
 * RAW body BEFORE doing any work — no JSON parse, no DB lookup, no decode until it passes. Must
 * be registered with `express.raw` BEFORE `express.json` so `req.body` is the raw Buffer (the
 * same pattern as the Stripe webhook). On a verified `completed` event it resolves the job by
 * prediction id and hands it to the idempotent async worker.
 */
import type { Request, Response } from "express";
import { ENV } from "../_core/env";
import { verifyReplicateWebhook } from "../_core/net/replicateWebhookVerify";
import { getJobByPredictionId } from "../studioDb";
import { processAsyncJob } from "../studioAsyncWorker";
import { log } from "../serverLog";

export async function handleReplicateWebhook(req: Request, res: Response) {
  const rawBody = Buffer.isBuffer(req.body)
    ? req.body.toString("utf8")
    : typeof req.body === "string"
      ? req.body
      : "";

  const ok = verifyReplicateWebhook({
    id: req.headers["webhook-id"] as string | string[] | undefined,
    timestamp: req.headers["webhook-timestamp"] as string | string[] | undefined,
    signature: req.headers["webhook-signature"] as string | string[] | undefined,
    body: rawBody,
    secret: ENV.replicateWebhookSecret,
  });
  if (!ok) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  // Verified — only now is it safe to parse + act.
  let payload: { id?: unknown } ;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    res.status(400).json({ error: "invalid json" });
    return;
  }

  // Dark by default — accept (so Replicate doesn't retry) but do no work until enabled.
  if (!ENV.studioAsyncJobs) {
    res.status(202).json({ ok: true, skipped: "async disabled" });
    return;
  }

  const predictionId = payload?.id;
  if (typeof predictionId !== "string" || !predictionId) {
    res.status(400).json({ error: "missing prediction id" });
    return;
  }

  try {
    const job = await getJobByPredictionId(predictionId);
    if (!job) {
      res.status(202).json({ ok: true, skipped: "no job for prediction" });
      return;
    }
    const result = await processAsyncJob(job.id);
    res.status(200).json({ ok: true, jobId: job.id, result: result.status });
  } catch (error) {
    log.error("studio", "replicate-webhook handler error", { metadata: { error: (error as Error).message } });
    res.status(500).json({ error: "internal" });
  }
}
