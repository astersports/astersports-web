# Studio Async Generation Refactor — Design Spec

- **Status:** DRAFT for Architect review (CC-authored, evidence-grounded per CLAUDE.md §2.2).
- **Date:** 2026-06-22
- **Author lane:** CC (Claude Code)
- **Scope class:** Architect-scoped (money-path generate flow + DB schema/migration) — this is a
  design doc, not a PR. Nothing here ships until ratified.
- **Trigger:** Live density test failed at ~51s ("Connection closed before the job finished").
  Evidence analysis (below) shows a hard Manus ingress/request cap well under the SAM2 work
  duration. The synchronous SSE-on-request architecture cannot hold heavy SAM2 jobs.

---

## 1. The failure, grounded

Observed (Frank's device, density v? job): progress UI advanced to the cosmetic "Finalizing
result…" label, then at **~51s** the client showed **"Connection closed before the job
finished. Please try again."** Balance read post-deduct (no refund event received client-side).

What the code says about each fact:

| Evidence | File:line | Reading |
|---|---|---|
| Client error string is the reader-closed-with-no-terminal-event path | `client/src/hooks/useGenerateStream.ts:121` | The SSE pipe was **severed mid-stream**; the server's own `error` event never arrived. |
| Server timeout is 180s | `server/routes/studioStream.ts:289` | A code constant, NOT the platform cap. Cut at ~51s ⇒ the platform killed the request first; the 180s timeout never fired. |
| Heartbeats every 3s | `server/routes/studioStream.ts:262` | Rules out an **idle** timeout. This is a **total request-duration** cap, which heartbeats cannot defeat. |
| "Finalizing result…" is time-based cosmetic copy | `client/src/pages/studio/StudioEditor.tsx:357,369-375` | `ESTIMATED_DURATION=50s`; after 40s elapsed the label always says "Finalizing…", regardless of server stage. The job was still grinding, not finalizing. |
| SAM2 runs via a blocking long-poll | `server/_core/masking/replicateSam2.ts:69,165,188` | `replicate.run()` blocks the request until the prediction settles (`RUN_TIMEOUT_MS=120_000`). The 45–120s wait happens **inside** the HTTP request. |

**Root cause:** a hard Manus ingress/request-duration cap (~51s observed) < the in-request SAM2
duration (45–120s). `pointsPerSide=16` only narrows the gap; it does not close it durably.

**Immediate unblock vs. durable fix (not mutually exclusive):**
- *Immediate:* the `GET /api/studio/posture` `sam2.pointsPerSide` read. If `32`/`64`, the perf
  fix is on `main` but undeployed — redeploy `main` and density may sneak under the cap. This is
  a band-aid, not a fix.
- *Durable:* this refactor — move the long wait off the HTTP request entirely.

---

## 2. Key insight: the wait belongs to Replicate, not to our request

The dominant latency is the **remote** SAM2 prediction. Replicate's API is asynchronous by
design: `predictions.create()` returns a prediction id immediately (status `starting`), and
completion is delivered by **webhook** or discovered by **polling** `predictions.get(id)`. Our
own deterministic ops (decode + erase/composite + PNG encode in `densityThin` /
`densityRedistribute` / `scalePrintRepeat`) are **CPU-bound and fast (single-digit seconds)**.

So the architecture should be: **kick the prediction → return → finish the (fast) ops when the
prediction completes.** No request ever waits on SAM2.

---

## 3. Target architecture (Enqueue → Process → Poll → Refund)

```
Client                Enqueue (tRPC)           Replicate            Worker (cron)         Client poll
  | generate            |                        |                    |                     |
  |-------------------->| deduct credits (idem)  |                    |                     |
  |                     | create job: queued     |                    |                     |
  |                     | predictions.create --->| (starting)         |                     |
  |<-- { jobId } -------| (returns immediately)  |                    |                     |
  |                     |                        | ...SAM2 runs...    |                     |
  |                     |                        |                    | tick: poll pending  |
  |                     |                        |<-- predictions.get-|                     |
  |                     |                        |--- succeeded ----->| run op (CPU, fast)  |
  |                     |                        |                    | upload PNG          |
  |                     |                        |                    | addVariation; done  |
  |-- getJob (poll) ------------------------------------------------------------------------>|
  |<-- { status: done, variations } ---------------------------------------------------------|
```

No long-lived HTTP anywhere: enqueue is fast, each worker tick is bounded, the client polls.

---

## 4. Component changes (grounded in current files)

### 4.1 DB schema (Architect-scoped migration)
`jobs` today has `status: pending|processing|done|failed` and `controls`, `creditsUsed`
(`server/studioDb.ts`). Add:
- `status` gains **`queued`** (deducted + prediction created, awaiting SAM2). Keep `processing`
  for the brief ops phase; `done`/`failed` unchanged.
- `prediction_id` (text, nullable) — the Replicate prediction handle.
- `provider_status` (text, nullable) — last seen Replicate status (`starting|processing|succeeded|failed|canceled`).
- `enqueued_at` (timestamp) — drives the reaper deadline and a max-prediction-age cancel.
- (optional) `attempt` (int) — mirrors the per-attempt refId already used by SSE.

### 4.2 Provider: split the blocking call
Decompose so the create and the parse are separable (`server/_core/masking/replicateSam2.ts`,
`sam2Provider.ts:246`):
- `startAutoSegment(imageDataUrl, opts) → { predictionId }` via `replicate.predictions.create(...)`
  (replaces the `replicate.run()` long-poll). Carries the **C5 org_id/jobId audit stamp** exactly
  as today.
- `finishAutoSegment(prediction) → Sam2Segmentation` ({ combined, individuals }) — downloads via
  the existing SSRF-guarded `safeFetchBuffer`, builds fabric + instances.
- `MaskProvider` (`types.ts:75`) gains `startSegmentation` / `finishSegmentation` alongside the
  existing `getSegmentation` (kept for the eval runners + the dark SSE path during migration).

### 4.3 Enqueue (tRPC `studio.generate`)
- Validate + gate exactly as today (densityOnly/scaleOnly, rasterReady, DPI guard, trial,
  balance). Reject combined edits pre-deduct as now.
- **Deduct** credits with the per-attempt refId (`job-<id>-a<n>`, idempotent on `(refId,reason)`,
  `server/studioDb.ts:280`) — reservation reflected immediately.
- Create the job `queued`, call `startSegmentation`, persist `prediction_id`, return `{ jobId }`.
  No long wait → completes far under any ingress cap.

### 4.4 Process (new `/api/scheduled/process-studio-jobs`, Heartbeat cron)
Register beside the existing scheduled routes (`server/routers.ts:230`), same `x-cron-secret`
gate. Each tick:
- Select up to **N** jobs in `queued`/`processing` (N bounded so one tick stays under the cap;
  start N=3).
- For each: `predictions.get(prediction_id)`.
  - `succeeded` → `finishSegmentation` → run the deterministic op (`generateDensityImage` /
    `generateDensityRedistributeImage` / `generateScaledImage`) → upload PNG → `addVariation` →
    mark `done`. If the op signals a **no-op** (`removed===0` → `null`; scale `NO_OP_SCALE_ERROR`)
    → **refund** + mark `failed` (the §1 guard already in `aiEngine.ts`).
  - `failed`/`canceled` → refund + mark `failed`.
  - still running, and `enqueued_at` older than `MAX_PREDICTION_AGE` (e.g. 5m) → cancel + refund +
    mark `failed`.
  - else leave `queued` for the next tick.

### 4.5 Poll (client)
- Drop `useGenerateStream` / the SSE path for density/scale. The client calls `studio.generate`,
  gets `{ jobId }`, then polls `studio.getJob` (already exists, `server/routers/studio.ts:396`) via
  React Query `refetchInterval` (e.g. 2–3s) until `status` is `done`/`failed`; renders variations
  on `done`, the error + "credits refunded" on `failed`. **Client disconnect no longer affects the
  job** — a major robustness win over today.

### 4.6 Refund + reaper (backstop unchanged in spirit)
`reapStuckJobs` (`server/studioDb.ts:442`) already refunds stuck rows idempotently
(`job-<id>-%`). Keep it as the final backstop for lost webhooks / worker death; tune its deadline
to exceed `MAX_PREDICTION_AGE`.

---

## 5. Money-path invariants preserved (CLAUDE.md §1)
- **No bill for a no-op:** the `removed===0`→`null`→refund and `NO_OP_SCALE_ERROR` guards move
  intact into the worker; refund fires there.
- **Idempotent deduct/grant on `(refId,reason)`:** per-attempt `job-<id>-a<n>` deduct; refunds key
  to `<refId>-failed` / `job-<id>-reaped`. No double-charge, no double-refund.
- **No direct `creditBalance` writes:** all through `deductCredits`/`grantCredits`.
- **Reaper backstop** remains the load-bearing safety net on serverless container death — and
  becomes MORE important (it's the catch-all when a webhook/worker tick is lost). Its prod
  scheduling + `CRON_SECRET` is a hard go-live item (§6/§7).

## 6. Failure / refund matrix

| Failure | Detected by | Outcome |
|---|---|---|
| Balance / validation / combined-edit | enqueue, pre-deduct | reject, no charge |
| Deduct ok, `predictions.create` throws | enqueue | refund immediately, job `failed` |
| SAM2 `failed`/`canceled` | worker poll | refund, job `failed` |
| SAM2 degrade (no raster/instances) | worker (`generate*Image`→null) | refund, job `failed` |
| Op no-op (`removed:0` / empty scale) | worker (§1 guard) | refund, job `failed` |
| Prediction never completes (lost/stuck) | worker `MAX_PREDICTION_AGE` → cancel | refund, job `failed` |
| Worker/container death | reaper sweep | refund, job `failed` |
| Client disconnect | — | **no effect** (job runs server-side) |

---

## 7. Open forks for Architect ruling (options + CC lean)

- **Fork A — completion trigger.** (1) cron-poll only; (2) Replicate webhook only; (3) webhook
  primary + cron-poll backstop. *Entails:* (2)/(3) add a public `/api/studio/replicate-webhook`
  with HMAC signature verification (new inbound-auth surface). **Lean: (1) cron-poll for v1** —
  reuses the existing Heartbeat/scheduled infra, no new public-auth surface, latency bounded by
  the poll interval (~2–5s, negligible against a 45s prediction). Add webhook later as a latency
  optimization if needed.
- **Fork B — new `queued` status vs reuse `processing`.** **Lean: add `queued`** — the reaper
  deadline for "awaiting SAM2" differs from "running ops," and the distinction is diagnostically
  useful.
- **Fork C — client status transport.** Polling vs a lightweight non-blocking SSE status stream.
  **Lean: polling** — SSE is exactly what failed; a status poll is trivial, robust, and serverless-
  friendly.
- **Fork D — max prediction age.** **Lean: 5 min** cancel+refund, with the reaper deadline set
  above it.
- **Fork E — rollout.** Ship behind a new dark flag (e.g. `STUDIO_ASYNC_JOBS`) **parallel** to the
  existing SSE path; flip per §1 (Frank) after a real-garment eval; remove SSE once async is
  verified. **Lean: yes** — dark-by-default, no big-bang cutover.
- **Fork F — bundle with PR #81?** **Lean: NO.** #81 is a test + comment-accuracy only (no logic),
  independent of this refactor. Merge #81 on its own once the test window settles; this refactor is
  its own Architect-scoped PR series.
- **Fork G — privacy.** The data-URL crop input + C5 org_id/jobId audit stamp
  (`replicateSam2.ts`) must carry through `startAutoSegment` unchanged; crop-to-fabric
  minimization preserved. **Lean: preserve exactly**; no new persistence of customer bytes.

---

## 8. Proposed PR sequence (each Architect-scoped, each with tests + green CI)
1. **Migration** — `jobs` columns + `queued` status (no behavior change).
2. **Provider split** — `startSegmentation`/`finishSegmentation` (+ keep `getSegmentation`); unit
   tests with a mocked Replicate client.
3. **Enqueue + worker** — `generate` enqueues; `/api/scheduled/process-studio-jobs` processes;
   behind `STUDIO_ASYNC_JOBS` (dark). Tests cover the full failure/refund matrix (§6).
4. **Client poll** — route density/scale to enqueue + `getJob` polling under the flag.
5. **Remove SSE** — delete `studioStream.ts` + `useGenerateStream` once async is verified live.

## 9. Out of scope
- The generative (prompt) path — already returns inline, fast; unaffected.
- Credit pricing / plan logic.
- The classical provider (no SAM2; density/scale degrade-to-refund as today).

## 10. Open questions for Frank / Architect
1. What is Manus's **actual** max request/response duration (the real cap we hit at ~51s)? Is it
   configurable, and does it apply to `/api/scheduled/*` worker requests too (bounds N per tick)?
2. Does Manus reliably deliver **inbound webhooks** (Fork A)? If not, cron-poll stands as v1.
3. Is there a Manus **queue/background** primitive, or is the Heartbeat cron the only async trigger?
   (The design assumes cron-only; a native queue would simplify the worker.)
