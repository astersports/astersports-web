/**
 * T0.1 — Refund telemetry emitter.
 *
 * Every refund call site MUST call `emitRefundTelemetry` with the appropriate reason.
 * This creates a queryable, rankable record in server_logs under source='studio-refund'.
 *
 * Query pattern:
 *   SELECT JSON_EXTRACT(metadata, '$.refundReason') AS reason, COUNT(*) AS cnt
 *   FROM server_logs WHERE source = 'studio-refund'
 *   AND created_at >= NOW() - INTERVAL 24 HOUR
 *   GROUP BY reason ORDER BY cnt DESC;
 */
import { log } from "./serverLog";
import type { RefundReason } from "../shared/refundReasons";

export interface RefundTelemetryEvent {
  reason: RefundReason;
  jobId: number;
  tenantId: number;
  userId?: number;
  credits: number;
  /** Additional context (error message, prediction ID, etc.) */
  detail?: string;
}

/**
 * Emit a structured refund telemetry log line.
 * Fire-and-forget — never throws, never blocks.
 */
export function emitRefundTelemetry(event: RefundTelemetryEvent): void {
  log.warn("studio-refund", `refund: ${event.reason}`, {
    jobId: event.jobId,
    tenantId: event.tenantId,
    userId: event.userId,
    metadata: {
      refundReason: event.reason,
      credits: event.credits,
      detail: event.detail,
    },
  });
}
