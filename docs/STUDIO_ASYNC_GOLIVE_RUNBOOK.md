# Studio Async Generation — Go-Live Runbook (for Manus)

**What's shipping:** density/scale generation moves off the synchronous SSE request onto an
enqueue → poll model, clearing the hard ~60s Manus ingress/request timeout that was killing dense
SAM2 jobs. The heavy SAM2 run lives on Replicate (off our request); a worker (cron poll) finishes
off-request; the client polls `getJob`. All dark behind one new flag (`STUDIO_ASYNC_JOBS`), and the
flag-off path is byte-identical to today's behavior.

Spec: `docs/ASYNC_GENERATION_SPEC.md`. Phases 1–4: PRs #82–#86.

---

## Precondition
**PR #86 is merged to `main`.** (It is the capstone client piece — green on CI; it carries the
`useAsyncGenerate` polling hook + the `StudioEditor` wiring + `studio.config.asyncJobs`.)

---

## 1. Deploy `main`
- Auto-deploy from `main` as usual.
- **Confirm the deploy ran `pnpm run db:push`** (which runs `drizzle-kit migrate`) so migrations
  **`0016`** and **`0017`** apply BEFORE the new server boots:
  - `0016` — `studio_jobs.status` ENUM gains `sam2_processing`, `cpu_processing`; adds `predictionId`,
    `enqueuedAt`.
  - `0017` — adds `studio_jobs.predictionMeta` (json).
  - Both are additive + nullable / appended-enum — **no backfill, no data migration**.
- Confirm the app boots green.

## 2. Schedule ONE new cron — *this is what completes async jobs*
- **`POST /api/scheduled/poll-predictions`**, authenticated as a cron task (isCron) with the
  **`x-cron-secret: $CRON_SECRET`** header — exactly the same pattern as the existing
  `/api/scheduled/*` jobs (reap-stuck-jobs, trial-reminders, …).
- **Interval: as short as the platform allows (ideally 10–30s; 1 minute is acceptable).** Shorter =
  lower latency between the SAM2 prediction finishing and the result appearing. It is internally
  bounded to **N=1 job per tick**, so a single tick always clears the 60s execution cap with headroom.
- **No webhook required.** `/api/webhooks/replicate` exists (fail-closed svix HMAC verify) but is not
  wired yet — it needs a public base URL + `REPLICATE_WEBHOOK_SECRET`. Cron-poll is the load-bearing
  completion path for now; the webhook is a future latency optimization (instant instead of
  poll-interval).

## 3. Confirm existing infra (should already be true)
- `/api/scheduled/reap-stuck-jobs` still scheduled — the ultimate refund backstop. It now also reaps
  jobs stuck in `sam2_processing` / `cpu_processing` (e.g. a lost cron tick or a worker death), so a
  customer is never charged for a job that produced nothing.
- Env present: `CRON_SECRET`, `STUDIO_MASK_PROVIDER=sam2`, `REPLICATE_API_TOKEN`,
  `REPLICATE_SAM2_MODEL`, `STUDIO_SAM2_POINTS_PER_SIDE=16`.

## 4. The flip — Frank's hand, not Manus's (CLAUDE.md §1/§3)
The only new env change. Set **only on Frank's explicit instruction**, as one deliberate flip
(never batched with other flag changes):

```
STUDIO_ASYNC_JOBS = true
```

Leave `STUDIO_DENSITY_LIVE=true`, `STUDIO_DENSITY_REDISTRIBUTE=true`, `STUDIO_MASK_PROVIDER=sam2`
unchanged. **Do not touch any other `*_LIVE` flag or the mask provider.**

## 5. Post-flip smoke
- `GET /api/studio/posture` (with `x-cron-secret`) → expect:
  `asyncJobs: true`, `flags.densityRedistribute: true`, `effective.densityLive: true`,
  `maskProvider: "sam2"`, `sam2.pointsPerSide: 16`.
- Editor density test on a real garment → request returns **instantly**, the UI shows the polling
  state, and the result lands as a **v2 redistribute** (even / no-clustering) image — no hang at
  ~51s.
- Ledger check: a `credit_ledger` deduct lands at enqueue; on success no refund; on a `removed:0`
  no-op (or any failure) a matching refund lands (net zero). §1 holds.

## 6. Rollback (kill switch — Frank's hand)
If the async smoke misbehaves, **set `STUDIO_ASYNC_JOBS = false`**. That instantly reverts
density/scale to the unchanged synchronous SSE path — **no redeploy needed**, no data to undo (the
schema additions are inert when the flag is off). Diagnose after.

---

### Summary
- **Manus:** deploy `main` (with `db:push`), schedule `poll-predictions`, confirm the reaper + secrets.
- **Frank:** the `STUDIO_ASYNC_JOBS=true` flip + the smoke test (and `=false` to roll back).
