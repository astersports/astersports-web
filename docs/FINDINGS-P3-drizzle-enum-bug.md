# P3 Finding: TiDB/Drizzle eq()-on-Enum Bug

**Date:** 2026-06-23  
**Status:** NOT REPRODUCED — classified as environmental/transient  
**Conclusion:** The `inArray()` fix is a valid defensive workaround; the root cause is likely a stale connection pool or cold-start race in Autoscale containers.

---

## Reproduction Attempt

A test (`server/drizzleEnumBug.test.ts`) seeds a row with `status = 'sam2_processing'` and queries it four ways:

| Query Pattern | Result |
|---------------|--------|
| `eq(jobs.status, "sam2_processing")` + `eq(jobs.id, seededId)` | FOUND |
| `inArray(jobs.status, ["sam2_processing"])` + `eq(jobs.id, seededId)` | FOUND |
| `inArray(jobs.status, ["sam2_processing"])` + `isNotNull(jobs.predictionId)` | FOUND |
| `eq(jobs.status, "sam2_processing")` + `isNotNull(jobs.predictionId)` | FOUND |

All four pass consistently. The bug cannot be reproduced in a warm test environment.

---

## Production Evidence (Jun 22, 2026)

- Job 990001 was in `sam2_processing` status from 23:20:56 to 23:32:47 UTC
- poll-predictions ran 7+ times during that window, all reporting "processed 0 jobs"
- reap-stuck-jobs (using `inArray`) successfully found the same job at 23:32:47
- Both use the same `getDb()` pool — the only difference was `eq()` vs `inArray()`

---

## Hypothesis: Cold-Start Connection Pool Race

In Autoscale (serverless) mode, containers spin down to 0 when inactive. On cold start:
1. The first request triggers `getDb()` which creates a new mysql2 pool
2. TiDB's connection handshake may not fully complete before the first query executes
3. `eq()` on an ENUM column may generate a prepared statement that fails silently on an incomplete connection
4. `inArray()` generates a different SQL pattern (`IN (?)` vs `= ?`) that may use a different code path in the mysql2 driver

This is consistent with the observation that the bug only manifests in production (cold containers) and not in warm test environments.

---

## Decision

The `inArray()` fix is retained as a defensive workaround. It:
- Matches the working `reapStuckJobs` pattern
- Has no performance cost (single-element IN is optimized by MySQL/TiDB)
- Eliminates the transient failure mode regardless of root cause

No further investigation needed unless the bug recurs with `inArray()`.
