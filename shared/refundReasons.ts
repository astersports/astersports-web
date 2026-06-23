/**
 * T0.1 — Per-guard refund-reason telemetry.
 *
 * Every refund path must emit exactly one reason from this enum.
 * The structured log line enables ranking refund reasons over a time window
 * via: SELECT metadata->'$.refundReason', COUNT(*) FROM server_logs
 *      WHERE source='studio-refund' GROUP BY 1 ORDER BY 2 DESC
 */

export const REFUND_REASONS = {
  /** boundaryRaster was null/missing when required by redistribute */
  boundary_missing: "boundary_missing",
  /** boundaryRaster dimensions don't match expected crop dimensions */
  boundary_dims: "boundary_dims",
  /** fabric raster dimensions don't match expected crop dimensions */
  raster_dims: "raster_dims",
  /** instance raster dimensions don't match expected crop dimensions */
  instance_dims: "instance_dims",
  /** density op removed 0 motifs (no-op on round 0 — nothing to thin) */
  round0_noop: "round0_noop",
  /** SAM2 found too few instances for meaningful density operation */
  under_seg: "under_seg",
  /** degrade to generative path (density/scale guard failed, non-specific) */
  degrade_other: "degrade_other",
  /** worker deadline exceeded (T1.4 cancel-safe timeout) */
  deadline: "deadline",
  /** poison-pill: max poll attempts exceeded (T1.3) */
  poison_pill: "poison_pill",
  /** SAM2 prediction returned error status */
  sam2_error: "sam2_error",
  /** enqueue/start failure (couldn't start the job) */
  enqueue_failure: "enqueue_failure",
  /** all variations in a batch failed */
  all_failed: "all_failed",
  /** partial variation failures in a batch (pro-rate refund) */
  partial_failed: "partial_failed",
  /** reaper timeout (job stuck past deadline, reaped by cron) */
  reaper_timeout: "reaper_timeout",
  /** SSE stream: status-write failure before generation started */
  status_write_failure: "status_write_failure",
  /** SSE stream: generation threw an error */
  stream_error: "stream_error",
  /** scale op: non-repeat pattern detected */
  non_repeat: "non_repeat",
  /** controls missing or invalid */
  missing_controls: "missing_controls",
  /** no async-supported op found in controls */
  no_async_op: "no_async_op",
} as const;

export type RefundReason = (typeof REFUND_REASONS)[keyof typeof REFUND_REASONS];
