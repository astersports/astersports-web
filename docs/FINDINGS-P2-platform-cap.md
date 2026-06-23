# P2 Finding: Platform Execution Cap

**Date:** 2026-06-23  
**Status:** RESOLVED  
**Conclusion:** Platform cap is **180 seconds** for HTTP requests (Autoscale serverless functions).

---

## Evidence

### 1. Code Documentation (server/_core/env.ts, line 85)

> "Request timeout raised to 180s (platform cap); default lowered to 16 to keep typical density jobs well under 30s."

This comment refers to the SAM2 points_per_side tuning and explicitly states the platform cap.

### 2. Heartbeat Cron Execution History

| Metric | reap-stuck-jobs | poll-predictions |
|--------|----------------|-----------------|
| Total runs observed | 169 | 200 |
| Max duration | 19,375ms | 7,776ms |
| Average duration | 590ms | 642ms |
| Timeout errors | 0 | 0 |

No cron invocation has ever been killed by a timeout. The platform allows cron callbacks to run for at least 19s (observed max) with no upper bound hit.

### 3. SAM2 Client Timeout (replicateSam2.ts)

`RUN_TIMEOUT_MS = 120_000` (120s) — the caller-side deadline for Replicate API calls. This is set below the 180s platform cap to ensure the function returns before being killed.

### 4. Original SSE Problem

The original 60s timeout that killed SSE streams was the platform's previous default for standard HTTP requests. This was raised to 180s, and the architecture was changed to async (STUDIO_ASYNC_JOBS=true) so the SAM2 call runs on Replicate's infrastructure, not within the platform's request lifecycle.

---

## Implications for T1.4 (Worker Deadline)

The worker deadline (AbortController + Promise.race) should be set to **150 seconds** — leaving a 30s margin below the 180s platform cap for cleanup, logging, and response serialization.

The actual expected execution time for a density/scale job:
- SAM2 prediction: 15-45s (runs on Replicate, polled by cron — NOT within the worker deadline)
- CPU processing (density/scale ops): 5-30s depending on instance count
- S3 persist: 1-3s

Total worker time (post-SAM2): ~10-35s, well within the 150s deadline.
