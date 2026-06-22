# Async Generation Refactor (Money-Path) — Design Spec

**Status:** Proposed Architecture — Architect-ratified direction, CC ground-truth reconciliation pending review.
**Date:** 2026-06-22 · **Lanes:** Architect (design/rulings) + CC (verification/implementation).
**Scope:** Architect-scoped (money-path generate flow + DB schema/migration). Design only — nothing ships until ratified. Supersedes the earlier `STUDIO_ASYNC_JOB_REFACTOR_SPEC.md` draft.
**Goal:** Resolve the ~50–60s Manus ingress timeout that kills dense SAM2 generations, by decoupling the long-polling `replicate.run()` from the synchronous HTTP request, while preserving the airtight ledger invariant (no stranded charges, no bill-for-no-op).

---

## 0. CC ground-truth reconciliations (read first — review these)

The Architect's draft is adopted below with these details reconciled against the live code (CLAUDE.md §2.3 source hierarchy; `[GROUNDED]` = verified in-repo, `[VERIFY]` = needs a vendor/runtime check):

1. **`status` is a MySQL `ENUM`, not free text.** `[GROUNDED]` `drizzle/schema.ts:233` — `studio_jobs.status = mysqlEnum("status", ["pending","processing","done","failed"]).default("pending")`. New states require an `ALTER TABLE studio_jobs MODIFY status ENUM(...)` migration (not a no-op).
2. **Keep the existing terminal names `done`/`failed`; do NOT rename to `completed`.** `[GROUNDED]` `done`/`failed` are used by `updateJobStatus` (`server/studioDb.ts:410`), the history filters (`listTenantJobsEnhanced`), and the reaper (`reapStuckJobs` sets `failed`, scans `processing`). Renaming to `completed` churns every callsite for zero benefit. Map the Architect's `completed` → existing **`done`**.
3. **`refunded` as a distinct status is OPTIONAL (minor fork).** `[GROUNDED]` today a refund = `status='failed'` + a `refund` row in `credit_ledger` (the ledger is the source of truth for "money returned"). A separate `refunded` status is a UI nicety that ripples through filters/reaper. **CC lean: skip it** — `failed` + refund ledger row already encodes it. Add only if the Architect wants an explicit UI distinction.
4. **`result_url` already exists on `job_variations.resultUrl`** `[GROUNDED]` `drizzle/schema.ts:255` via `addVariation` (`server/studioDb.ts`). The client reads results through `studio.getJob` (which returns `variations`). **Do NOT add `result_url` to `studio_jobs`** — it would duplicate the variation row.
5. **New columns actually needed on `studio_jobs`:** `prediction_id` (varchar, the Replicate handle) + the two intermediate ENUM states below. `creditsUsed`, `controls`, `errorMessage` already exist.

**Reconciled state set:** `pending → sam2_processing → cpu_processing → done | failed` (+ keep legacy `processing` in the ENUM so in-flight/SSE rows and the existing reaper query still resolve during migration).

---

## 1. The state machine & schema

- **Target table:** `studio_jobs` (`drizzle/schema.ts:216`) — the table behind the `job-<id>-%` refIds in `countJobGenerationAttempts`.
- **Migration (Architect-scoped):**
  - `status` ENUM gains `sam2_processing`, `cpu_processing` (keep `pending`,`processing`,`done`,`failed`).
  - add `prediction_id varchar(255) NULL`, `enqueued_at timestamp NULL`.
- **State flow:** `pending` (job row created) → deduct credits → `sam2_processing` (awaiting Replicate prediction) → `cpu_processing` (running deterministic v1/v2 density or scale ops) → `done` (variation saved) **or** `failed` (degrade / no-op / provider failure / reaped — always paired with a `refund` ledger row when a deduct happened).

## 2. The Replicate seam (split the blocking call)

Today `getSegmentation`/`autoSegment` block via `replicate.run()` (`server/_core/masking/replicateSam2.ts:69,165,188` — long-polls until the prediction settles, `RUN_TIMEOUT_MS=120_000`). Split it:

- **Start (`startPrediction`):** `replicate.predictions.create({ version, input, webhook, webhook_events_filter:["completed"] })` returns immediately with a `prediction_id`. Carries the **C5 org_id/jobId audit stamp** unchanged; input stays the privacy-minimal base64 data-URL (no Aster-stored crop). `[VERIFY]` exact `predictions.create` signature against the installed `replicate` SDK version.
- **Finish (`processPrediction`):** given a settled prediction's output, download masks via the SSRF-guarded `safeFetchBuffer`, build `{ combined, individuals }` → fabric + instances, then run the deterministic op. `MaskProvider` (`types.ts:75`) gains `startSegmentation`/`finishSegmentation`; existing `getSegmentation` stays for the eval runners and the dark SSE path during migration.

## 3. The processor — Hybrid Webhook + Cron fallback **[RATIFIED]**

- **Primary — webhook `/api/webhooks/replicate`:** signature-verified (NOT cron-secret; a distinct public surface). Replicate POSTs on `completed`. Handler verifies the signature, loads the job by `prediction_id`, runs `processPrediction` (CPU ops — single-digit seconds, far under the ingress cap), saves the variation, sets `done` (or refunds → `failed`).
  - **Security:** HMAC verification over Replicate's signed content using a `REPLICATE_WEBHOOK_SECRET` stored in **env** (consistent with this repo's env-based secrets + `validateEnv` fail-fast, §6 — note: astersports-web uses env, not an `app_secrets` table). **Fail-closed:** an unverified/with-no-secret request does no work and returns 401. No SSRF/decode work before signature passes. `[VERIFY]` Replicate's exact signing scheme (headers, signed payload) against current Replicate docs before build.
- **Fallback — cron `/api/scheduled/poll-predictions`:** reuses `registerScheduledRoutes` (`server/routers.ts:230`) + the `x-cron-secret` gate + the Heartbeat scheduler (~10s). Selects jobs in `sam2_processing`, calls `predictions.get(prediction_id)`, and runs the same `processPrediction` path if settled. Guarantees no job is lost to a dropped webhook. Bounded N per tick (start N=3) so a tick stays under the request cap.
- Both routes funnel into ONE idempotent `processPrediction(jobId)` so webhook and cron can't double-process (guarded by a status check + the idempotent ledger).

## 4. The client contract — lightweight status SSE **[RATIFIED]**

- **Step 1 (mutation):** `POST /api/studio/generate` (or the tRPC equivalent) → deduct credits (writes `credit_ledger` row, idempotent per-attempt refId `job-<id>-a<n>`, `server/studioDb.ts:280`) → create job → `startPrediction()` → return `{ jobId, status:"sam2_processing" }` in < ~2s. No long wait.
- **Step 2 (status stream):** client opens `GET /api/studio/stream-status?jobId=<id>` — a **status-only** stream that does NO work; it polls the DB (~2s) and pushes `status` events. If the Manus ingress cuts it at ~51s the client **reconnects and resumes** — the backend work is unaffected. On `done` it pushes the variation(s) (read via the existing `getJob` shape) and closes; on `failed` it pushes the refunded error.
  - `[CC-NOTE]` This reintroduces an SSE connection (with reconnect logic). Plain `getJob` polling via React Query `refetchInterval` is the strictly-simpler fallback with no reconnect handling — offered only if the reconnect path proves fiddly; the status-SSE choice is the Architect's and is adopted.

## 5. Ledger integrity & refund guarantees (CLAUDE.md §1)

The key invariant **shift**: moving off the synchronous request means the **client-disconnect `catch` can no longer be the refund trigger**. The safety net moves entirely to the DB state machine + the webhook/cron processor + the reaper.

- **Degrade / no-op:** when `processPrediction` runs the op and gets `removed:0` / `null` (density) or `NO_OP_SCALE_ERROR` (scale), it calls the same idempotent `grantCredits(tenantId, cost, "refund", "<deductRef>-failed", userId)` (`server/studioDb.ts:344`) before marking `failed`. (The guards already exist in `aiEngine.ts`.)
- **Replicate failure:** a `failed`/`canceled` prediction → webhook/cron refunds immediately → `failed`.
- **Ultimate backstop — reaper:** `/api/scheduled/reap-stuck-jobs` (`reapStuckJobs`, `server/studioDb.ts:442`) currently scans `status='processing'` + no `job-<id>-%` refund row. Extend it to also scan **`pending` / `sam2_processing` / `cpu_processing` older than 5 min** (must exceed `MAX_PREDICTION_AGE`), refund idempotently, mark `failed`. This is the catch-all for a lost webhook AND a dead cron/container.
- **Invariants preserved:** idempotent on `(refId,reason)`; no direct `creditBalance` writes; no double-refund (reaper only refunds when no `job-<id>-%` refund exists, and `grantCredits` is itself idempotent). Reaper prod-scheduling + `CRON_SECRET` is a hard §6/§7 go-live item — and now load-bearing for every async job, not just strands.

## 6. Failure / refund matrix

| Failure | Detected by | Outcome |
|---|---|---|
| Balance / validation / combined-edit | enqueue, pre-deduct | reject, no charge |
| Deduct ok, `predictions.create` throws | enqueue | refund, `failed` |
| SAM2 `failed`/`canceled` | webhook / cron | refund, `failed` |
| SAM2 degrade (no raster/instances) | `processPrediction` → null | refund, `failed` |
| Op no-op (`removed:0` / empty scale) | `processPrediction` (§1 guard) | refund, `failed` |
| Prediction never settles | reaper > 5 min | refund, `failed` |
| Webhook dropped | cron fallback | processed normally |
| Webhook + cron both dead | reaper | refund, `failed` |
| Client disconnect / reconnect | — | **no effect** (work is server-side) |

## 7. Forks status
**Ratified (Architect):** hybrid webhook + cron fallback (§3); lightweight status-only SSE (§4); reaper extended to the new states + 5-min age (§5).
**Open (minor, CC lean):** (a) `refunded` status — *lean skip* (use `failed` + ledger row, §0.3); (b) status-SSE vs plain polling — *lean polling as the simpler fallback*, deferring to the ratified SSE; (c) bundle with PR #81 — *lean NO*, #81 is test + comments only, merge independently.

## 8. Execution phases (each its own Architect-scoped PR, tests + green CI, behind a dark `STUDIO_ASYNC_JOBS` flag until verified)
1. **Schema & state:** ENUM `+sam2_processing,+cpu_processing`; `prediction_id`, `enqueued_at` on `studio_jobs`.
2. **Provider split:** `replicateSam2.ts` → `startPrediction` + `processPrediction` (mocked-Replicate unit tests).
3. **Async processor:** `/api/webhooks/replicate` (HMAC, fail-closed) + `/api/scheduled/poll-predictions` + the shared idempotent `processPrediction`; full §6 matrix tests.
4. **Client contract:** `POST` + `/api/studio/stream-status` (reconnect-safe) under the flag.
5. **Backstop + cutover:** extend `reapStuckJobs`; once verified live, remove `studioStream.ts` + `useGenerateStream`.

## 9. Open questions for Frank / Architect
1. Manus's **actual** max request duration (the real ~51s cap) — configurable? Does it bound `/api/scheduled/*` + `/api/webhooks/*` too (sets N per tick)?
2. Does Manus reliably deliver **inbound webhooks** to `/api/webhooks/replicate`? (If flaky, cron-poll carries v1 and webhook is pure latency upside.)
3. Confirm `REPLICATE_WEBHOOK_SECRET` provisioning + Replicate's current signature scheme (§3 `[VERIFY]`).

## 10. Out of scope
Generative (prompt) path — already inline/fast. Credit pricing/plans. Classical provider (degrade-to-refund as today).
