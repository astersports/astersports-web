# Density — Safeguard & Reliability Fixes (implementation record)

**Status:** CC implementation, opened as a **held draft PR** (§2.4). Two changes are
routine/additive (auto-merge-eligible on green CI); **two are money-path / Architect-scoped**
and must hold for Architect review — they are NOT to be auto-merged to `main`.
**Method:** a 6-validator read-only audit of the density pipeline on `main`, cross-checked
against the parallel session's 8-validator audit (`docs/DENSITY_OPTIMIZATION_AUDIT.md`, #96).
Every claim below is `file:line` grounded. CI: `pnpm run check` + `pnpm run test` green
(517 passed / 14 cred-skipped).

The two audits **agree on every big call**: all four proposed "next-level" optimizations
(spatial-hash grid, 1-bit masks, packing-density pre-flight bound, the "45s loop circuit
breaker" framing) are non-problems behind a 30–120s SAM2 call and were NOT built; "sub-second
end-to-end / 100% accuracy" is not a reachable target (SAM2 dominates; the quality ceiling is
segmentation + flat-fill infill, gated on a G3 eval bench that does not yet exist). What this
PR ships is the **validated reliability/safeguard set** — the items that are real, grounded,
and self-contained.

---

## What shipped (this PR)

### Routine / additive (auto-merge-eligible)

**1. GAP-1 — refund on `boundaryRaster` dimension drift.**
`densityRedistribute` validated `raster` dims (`densityRedistribute.ts:173`) and per-instance
raster dims (`:197`) but **never** `boundaryRaster` dims. The boundary is consumed at
image-space indices (blueNoiseLayout's `w*h` walk; the composite clip
`boundary.data[dY*width+dX]`), so a dim-drifted boundary mis-indexes the clip — silently
**dropping motif pixels or painting off-garment** — composing a CORRUPTED result the caller
would still **bill** (`removed > 0`). This was the *only* reachable path to a corrupted paid
image; every other failure already degrades to a refund. Fix: a dim guard (parity with the two
existing checks) → `empty()` → refund. Latent today (the sole producer, `sam2Provider`, builds
both rasters at identical dims), but the dual-mask design treats them as independent — so this
is defense-in-depth that becomes load-bearing the moment any future provider emits the boundary
separately. Test: `densityRedistribute.test.ts` "GAP-1".

**2. H1 — two-sided NNI band on the shipping eval verdict.**
The live op is v2 (`studioEngine` selects `densityRedistribute` when the flag is on), but
`redistributeVerdict` floored `placementEvenness >= 1.0` with **no upper cap**
(`redistributeMetrics.ts:265`) — while v1's `densityVerdict` already has a tested two-sided band
(`densityMetrics.ts:293-295`, nniMin/nniMax). `blueNoiseLayout` deliberately stops Lloyd short
of convergence precisely to avoid drifting into a crystalline hex lattice (NNI → 2.1491); with
only a floor, the *shipping* verdict cannot detect that failure. Fix: add
`placementEvennessMax` (default **Infinity** → no behaviour change) so the cap can be calibrated
on the G3 bench. Eval-only; not the live accept/bill path. Test:
`redistributeMetrics.test.ts` "placementEvenness band (H1)".

### Money-path / Architect-scoped (HOLD for review — do not auto-merge)

**3. Reaper clock — sweep on an immutable timestamp, not mutable `updatedAt`.**
`reapStuckJobs` aged jobs off `lte(jobs.updatedAt, cutoff)` (`studioDb.ts:515`), but
`updatedAt` is `onUpdateNow()` (`schema.ts:270`) — so every status write, **including the
`sam2_processing → cpu_processing` claim**, resets the backstop's clock. The schema's own
comment says `enqueuedAt` "drives the reaper's max-prediction-age sweep" (`schema.ts:263`); the
code disagreed. A repeatedly-touched strand could evade the sweep, weakening the "a stranded job
is refunded, not charged" guarantee. Fix: age off `COALESCE(enqueuedAt, createdAt)` — immutable
for both async (`enqueuedAt`) and sync `processing` (`createdAt`, since `enqueuedAt` is null
there). Existing reaper integration test uses a future cutoff, so it stays green.

**4. Cancel-safe in-worker deadline — a slow async op refunds instead of stranding.**
*This is the headline fix for the reported symptom* ("timed out after 60s and charged 10
credits"). Confirmed root cause: the off-request worker has **no in-op wall-clock deadline**
(grep-confirmed), and the poll-predictions cron runs it inside the Manus **~60s execution cap**
(`studioDb.listSam2ProcessingJobs` processes N=1 expressly "to clear the Manus 60s execution
cap", `studioDb.ts:455-456`). A CPU op that outruns the cap is hard-killed mid-run; the job is
orphaned in `cpu_processing` (the poller claims `sam2_processing` only) and the charge sits until
the reaper — which #3 had also weakened. The client's 50s estimate then reads as "timed out".

Fix: race the op against `ENV.studioWorkerDeadlineMs` (default **45s**, *below* the cap) →
`failAndRefund`. **Cancel-safety** (the one real hazard the parallel audit flagged): a naive
`Promise.race` would let the still-running op later `addVariation` + mark `done` *after* the
deadline refunded — a deliver-AND-refund double-resolve. Prevented with two atomic
compare-and-set helpers (`studioDb.ts`, modeled on `claimJobForCpuProcessing`):
- `completeJobIfProcessing` — `cpu_processing → done` only if still owned; a late result whose
  CAS loses is **discarded**.
- `failJobIfClaimable` — `{sam2,cpu}_processing → failed`; the worker refund is **gated** on
  winning it, so a delivered+billed job is never refunded and no double-refund is issued
  (grantCredits idempotency is the second backstop).

Tests (`studioAsyncWorker.test.ts`): deadline → refund+failed with the late result discarded
(no double-refund); op-beats-deadline → done+billed, no refund; refund skipped when a peer
already finalized.

> **Correction to the parallel session's spec:** it recommended a **~90–120s** deadline on the
> premise that the worker is "not under the 60s cap." That is contradicted by
> `studioDb.ts:455-456` (the cap is real) and `studioAsyncWorker.ts:60-66` (the worker reads the
> prediction once and returns `pending` if SAM2 is still running — it never block-awaits the
> 30–120s inference, so the deadline wraps only the post-success CPU op). A 90–120s deadline
> would be hard-killed by the 60s cap before it could fire `failAndRefund` — i.e. it would not
> fix the strand. 45s (below the cap) is correct; raise it only if the platform cap is raised.

---

## Deliberately NOT in this PR

- **`cpu_processing` re-claimable / lease column** — the structural other half of #4 (a job
  killed *between* claim and the deadline is still poller-invisible). Needs a schema column
  (`leaseExpiresAt`) and a claim-predicate change → a focused Architect-scoped change of its own.
- **Box-prompt garment silhouette** (the `boundaryRaster = motif union` ceiling). The unused
  `boxMask` path exists (`replicateSam2.ts:84,260`); wiring it is **mask-provider-scoped** (§2.4)
  and gated on the G2 privacy re-confirm. Highest-leverage *quality* fix, but not a safeguard.
- **DLQ / max-claim-attempt poison-pill**, segmentation caching for reruns, `points_per_side`
  tuning — real but separate; tracked in #96.
- **The four debunked optimizations** — not built (would add risk for 0 user-visible gain).

## Owed (unchanged)

§1 post-deploy smoke on the prior money-path merges (#91/#92/#93) and on #4 once merged:
app boots green + `GET /api/studio/posture` matches intended flag state. Manus auto-deploys from
`main`; CC is blind to prod, so this needs Frank/Manus.
