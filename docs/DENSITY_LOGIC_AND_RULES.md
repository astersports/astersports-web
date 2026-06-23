# Print Studio — Density: Full Logic & Rules

**Repo:** astersports/astersports-web @ `main` (8a83483) · **Stack:** Drizzle + mysql2 (MySQL-wire / TiDB) · **Date:** 2026-06-23

> Provenance: extracted read-only from `main` @ 8a83483 and synthesized from source.
> Every claim is `file:line`-cited — verify with `git show 8a83483:<path>`. Timeouts and
> safeguards are dedicated sections (§8, §9). Open/unverified items are tagged **[VERIFY]**.

---

## 0. Pipeline (the path a density job takes)

`studio.generate` (router) → gate `densityDeterministic` → **deduct** → `startSam2Segmentation`
(locate + crop, start Replicate prediction, return) → enqueue (`sam2_processing`) →
**off-request** worker (`poll-predictions` cron / Replicate webhook) → `processAsyncJob` →
atomic claim (`cpu_processing`) → `finishSam2Segmentation` (build masks + instances) →
`runDensityOnSegmentation` (v1 or v2) → `removed === 0 ? failAndRefund : addVariation + done`.

The SSE path (`/api/studio/generate-stream`) is the legacy on-request variant used when
`STUDIO_ASYNC_JOBS` is off (holds the request open; subject to the ~60s platform cap).

---

## 1. Flags & op selection

| Flag (`server/_core/env.ts`) | Meaning | file:line |
|---|---|---|
| `STUDIO_MASK_PROVIDER` | `classical` (default) / `sam2`; sam2 hard-required for density | env.ts:31 |
| `STUDIO_DENSITY_LIVE` | v1 (`densityThin`) live | env.ts:45 |
| `STUDIO_DENSITY_REDISTRIBUTE` | selects v2 (`densityRedistribute`) over v1 | env.ts:53 |
| `STUDIO_MAX_INSTANCES` | instance cap (default **200**) | env.ts:96 |
| `STUDIO_SAM2_POINTS_PER_SIDE` | SAM2 sampling density (default **16**; dominant cost) | env.ts:87 |

- **Gate:** `densityDeterministic = (studioDensityLive || studioDensityRedistribute) && getMaskProvider().rasterReady` — `studio.ts:170-172`. Without a raster-capable provider the op could only "deduct → call → refund," so the gate degrades to generative instead of charging for a guaranteed refund (`studio.ts:143-157`).
- **v1 vs v2 selection:** `studioEngine.runVariation` → `ENV.studioDensityRedistribute ? generateDensityRedistributeImage : generateDensityImage` (`studioEngine.ts:46-49`; `aiEngine.ts:34,95`). The async worker mirrors it: `runDensityOnSegmentation(..., ENV.studioDensityRedistribute)` (`studioAsyncWorker.ts:64-66`).
- **Density can't combine with other edits** — pre-deduct `BAD_REQUEST` reject (`studio.ts:179-184`, `studioStream.ts:154-157`).
- **`validateEnv`:** any `*_LIVE` / redistribute on without `STUDIO_MASK_PROVIDER=sam2` → boot fail-fast (`env.ts:149-153`).

---

## 2. Mask derivation — the DUAL MASK ⚠️

One `autoSegment` call yields three artifacts (`server/_core/masking/sam2Provider.ts`):

| Mask | What it is | Derivation | Used by |
|---|---|---|---|
| **`raster`** (sampling mask) | **full-crop bbox, `fill(255)`** — *not* a silhouette | `fabricFromSegment` sam2Provider.ts:187 | v1 + base-cloth sampling |
| **`boundaryRaster`** | decoded `seg.combined`, **labeled "garment silhouette"** | `decodeMaskToRaster(s.seg.combined)` sam2Provider.ts:191-193; type types.ts:49 | v2 layout / sampling / clip |
| **`instances`** | `individual_masks`, area-filtered + capped | `instancesFromSegment` sam2Provider.ts:214 | motif localization |

**⚠️ [VERIFY] — the core unresolved contradiction (the parked fork):**
- `sam2Provider.ts:179-184` calls `boundaryRaster` "the actual garment silhouette."
- `sam2Provider.ts:175-176` (adjacent) says `combined_mask` is "**sparse (only the motif union)**" — the documented reason `raster` was switched to bbox-fill.
- Both cannot be true on an all-over print. **Not empirically measured.** See `docs/ARCHITECT_DECISION_DENSITY_FIXES.txt`.

`decodeMaskToRaster` decodes via sharp resize→grayscale→raw, binary threshold `>127 ? 255 : 0` (`sam2Mask.ts:22`).

---

## 3. v1 `densityThin` — rules (erase-only)

`server/_core/studio/ops/densityThin.ts`

1. `removeN = clamp(round(n·percent/100), 0, n)`, `percent ∈ [0,90]` (densityThin.ts:89).
2. **Stratified select** which motifs to erase — farthest-point sampling + edge penalty (`stratifiedSelect.ts`; `EDGE_MARGIN=0.12`; interiority weight `0.3` at edge → `1.0` interior; edge motifs preferentially kept).
3. Removal region = selected, **dilate 2px**, ∩ `raster>127`, **∧ ¬survivors** (densityThin.ts:120-134).
4. Base-cloth color = dominant LAB cluster (kmeans k=3, seed=1) of `raster>127 ∧ ¬instance` (densityThin.ts:61-79,109).
5. `infillBaseCloth(... flatten:true, featherPx:1)` erase (densityThin.ts:141).
6. **Survivor byte-identity restore** — repaint survivors from the original buffer after feather (densityThin.ts:143-151).

Returns `{ removed: selected.length }` (0 on any no-op).

---

## 4. v2 `densityRedistribute` — rules (remove + relocate)

`server/_core/studio/ops/densityRedistribute.ts`

`const boundary = input.fabric.boundaryRaster ?? raster` (densityRedistribute.ts:179) —
**falls back to the full-crop raster if boundary is absent/degenerate** (the gap flagged as Fix 3).

1. Same count/guard prelude as v1 (`:187-201`).
2. Base-cloth sampling on **`boundary`** (`baseClothAnchor(... boundary ...)` `:207`).
3. `blueNoiseLayout(boundary, bbox, M, { seed })` → M even targets **inside boundary** (`:215`).
4. `assignTargets` survivors → targets, min squared displacement, deterministic tiebreak (`:220`; `assignTargets.ts`).
5. Erase ALL N originals (exact v1 infill) ∩ `raster>127` (`:224-237`).
6. Composite M survivors at targets — **no resize / no rotate** (scale + orientation preserved), alpha-feathered; **clip guard** `if (boundary.data[...] <= 127) continue` (`:263`) keeps motifs on garment.

Returns `{ kept, removed: n-kept, targets, assignments }`; invariant `removed + kept === n`.

---

## 5. Shared op primitives

- **`blueNoiseLayout`** (`blueNoiseLayout.ts`): jittered-grid seed → Lloyd / CVT relaxation, **FIXED 10 iterations, early-stop (NOT convergence)** (`:111,175`); `eps=0.75`, `edgeMargin=0.12`; **CAP=20000** strided sample bounds cost on a 40 MP raster (`:100`); seeded `mulberry32`.
- **`assignTargets`** (`assignTargets.ts`): builds all M×N pairs by squared distance, sorts by `(d2, source, target)`, greedy take — deterministic.
- **`stratifiedSelect`** (`stratifiedSelect.ts`): seed = instance nearest fabric center; greedy `max(dist² × interiority)`.
- **`kmeans`** (`kmeans.ts`): k-means++ seed, default 50 iters, early-stop, seed=1.
- **`infillBaseCloth`** (`infill.ts`): feather ≥ 0.3 uses sharp blur; alpha-blend toward base cloth; `flatten` replaces L + chroma.
- **`color`** (`color.ts`): `rgb255ToLab` / `labToRgb255` via culori; `clamp255` guarantees 0..255.

---

## 6. No-op / degrade → REFUND contract (§1 money invariant)

**Every** density no-op returns `removed:0` → caller returns `null` → `failAndRefund("density no-op (removed 0)")`. The op **never prompt-falls** (the generative path cannot do count-based removal).

| Guard | Condition | file:line |
|---|---|---|
| count | `n===0 \|\| percent<=0`; `removeN===0` (rounding) | densityThin.ts:88,90 / densityRedistribute.ts:190,192 |
| **F3** dim-drift | any instance raster dims ≠ image dims | densityThin.ts:100-106 / densityRedistribute.ts:198-201 |
| **F2** no bare ground | `baseClothAnchor` → null | densityThin.ts:112-115 / densityRedistribute.ts:208-210 |
| **F1** empty region | `regionCount===0` | densityThin.ts:139 / densityRedistribute.ts:235 |
| v2 layout | `targets.length===0`, `assignments.length===0` | densityRedistribute.ts:216,221 |
| degrade | `!raster \|\| !hasAnyPixel(raster) \|\| instances.length===0` | aiEngine.ts:45,106,220 |
| no-op sites | `result.removed===0 → null` | aiEngine.ts:70,129,227 |

---

## 7. Money / ledger rules

- **Deduct** at enqueue, per-attempt refId `job-<id>-a<N>` (`countJobGenerationAttempts + 1`) — `studio.ts:254`, `studioStream.ts:208`. The editor reuses the same `jobId` across regenerates, so a per-attempt key prevents a free 2nd generate / ledger drift.
- **Refund refIds:** worker `job-<id>-failed` (`studioAsyncWorker.ts:34`) — ⚠️ *per the decision doc, this fixed key collides with the `-a<N>` debit on the 2nd same-id attempt (Fix 1)*; SSE `job-<id>-a<n>-failed` (`studioStream.ts:235,345`); reaper `job-<id>-reaped`, only when no `job-<id>-%` refund row exists (`studioDb.ts:510-531`).
- **Idempotent on `(refId, reason)`**, SELECT-first `grantCredits` (no double refund); `deductCredits` atomic + balance-guarded.
- **Cost:** `computeCredits(controls, CREDIT_COST)` (`controls.ts:182`); `CREDITS_PER_GENERATION = 10` (`billing.ts:5`). Balance check + trial-expiry check pre-deduct.

---

## 8. ⏱️ ALL TIMEOUTS

| What | Value | file:line |
|---|---|---|
| **Manus ingress cap** (platform — the reason async exists) | ~**60s** | quoted: locateFabricRegion.ts:120, replicateSam2.ts:64, routers.ts:422 |
| SSE generation hard cap (`GENERATION_TIMEOUT_MS`) | **180s** | studioStream.ts:289,306 |
| SSE heartbeat interval | **3s** | studioStream.ts:262 |
| SSE socket timeout | **disabled** (`setTimeout(0)`, was Node 2-min) | studioStream.ts:243 |
| SAM2 `replicate.run` (`RUN_TIMEOUT_MS`) | **120s** | replicateSam2.ts:94 |
| SAM2 mask download (`DOWNLOAD_TIMEOUT_MS`) | **30s** | replicateSam2.ts:88 |
| Locate vision call (`LOCATE_TIMEOUT_MS`, Phase 5) | **20s** → `DEFAULT_REGION` | locateFabricRegion.ts:114 |
| Locate downscale fetch | **15s**; downscale `LOCATE_MAX_DIM=768` | locateFabricRegion.ts:125,115 |
| **Reaper sweep window** (stranded-job backstop) | **10 min** | routers.ts:410 (`reapStuckJobs(10*60*1000)`) |
| poll-predictions per tick | **N=1** (clears the 60s cap) | routers.ts:437 |
| Image download / generation / element-detect / presign | 30s / 120s / 60s / 10s | fetchTimeout.ts:43-49 |
| SAM2 points tuned to keep jobs < 30s | 16 (vs 32/64) | env.ts:82-87 |

---

## 9. 🛡️ ALL SAFEGUARDS

**Money / ledger**
- `rasterReady` gate (`studio.ts:170`); F1/F2/F3 + no-op→refund (§6); per-attempt refId + `(refId,reason)` idempotency (§7).
- Status-write-failure refund guard (`studioStream.ts:232-238`); enqueue start-failure refund (`studio.ts:274-282`).
- Whole-worker try/catch → `failAndRefund` on ANY throw (`studioAsyncWorker.ts:35-82`).
- Reaper stranded-job backstop sweeping `processing` / `sam2_processing` / `cpu_processing` (`studioDb.ts:510`).
- Balance + trial-expiry checks; density-can't-combine-with-other pre-deduct reject.

**Segmentation quality**
- `validateInstanceCount` — `MIN_DENSITY_INSTANCES=5`; 0 instances **or** `<5 && bboxArea>0.5` → warn (not fail) (`locateFabricRegion.ts:295-314`, called `aiEngine.ts:51,113`).
- Giant-instance filter `MAX_INSTANCE_FRACTION=0.20` (drops the "ground" segment so it isn't treated as a motif) (`sam2Provider.ts:212`).
- Locate min-area auto-expand (`MIN_AREA_FRACTION=0.35`; density `DENSITY_MIN_AREA=0.40`) → `DEFAULT_REGION {0.05,0.05,0.9,0.9}` on shortfall/timeout; bbox `EXPANSION_FACTOR=0.05` (`locateFabricRegion.ts`).

**Resource / OOM**
- `studioMaxInstances=200` (`env.ts:96`); `studioMaxMegapixels=40` + `assertWithinPixelLimit` (`guards.ts` / env.ts:78); `decodeSemaphore = studioMaxConcurrentDecodes = 4` (env.ts:81).
- `blueNoise CAP=20000` + stride, fixed Lloyd iterations; `baseClothAnchor` 20000-pixel sample cap.

**Concurrency**
- Atomic claim `sam2_processing → cpu_processing` via `affectedRows > 0` (`claimJobForCpuProcessing`, `studioDb.ts:440`) — only one worker runs the op; a lost claim is a safe skip, not a crash.

**Privacy / security**
- Crop-to-fabric minimization — only the crop goes to Replicate, never the full image (Req 1, `sam2Provider.ts:56`).
- Org-id audit log on every outbound SAM2 call (Req 2, `sam2Provider.ts:86`).
- SSRF-guarded fetches; webhook fail-closed HMAC (`replicateWebhook.ts:17`); cron auth `cronSecretOk` + `isCron`.

**Fail-safe degrade**
- `withFailSafe.getSegmentation` try/catch on timeout / fetch-fail / Replicate / ECONN → classical fallback → raster-less fabric + `[]` → density reads as degrade → refund (`masking/index.ts:106-129`; `classicalProvider.ts:38`).

**Op-internal**
- Clip guards `>127` (no motif bleed); v1 survivor byte-identical restore; F3 prevents bbox over-erase on dim-drift.

---

## 10. Eval acceptance thresholds (verdict gates)

**v1 `densityMetrics.ts`:** `countError≤0.10` (:290), `survivorIntegrity≤2` (:291), `evenness≤1.5` (:292), `NNI≥1.0` (:293), `infillCleanliness≤2.5` (:296), `bgDeltaE≤2` **excluded from pass** (:297), `removedTau=5` (:203). `pass = count & survivor & evenness & nni & infill`.

**v2 `redistributeMetrics.ts`:** `countError≤0.10` (:264), `placementEvenness NNI≥1.0` (:265), `palette≤5` (:266), `perMotif≤3` (:267), `scaleFidelity≤0.05` (:268), `infillCleanliness≤2.5` (:269), `bgDeltaE≤2` excluded (:270), `noopPass = removed>0`. `pass = count & evenness & palette & perMotif & scale & infill & noop`.

---

## 11. Invariants

- Count: `removeN = clamp(round(n·pct/100), 0, n)`.
- v1: survivors **byte-identical**. v2: **same identity + scale, NEW position**; `kept + removed === n`.
- Both ops **byte-deterministic** (seeded PRNG, fixed iteration counts, sorted tiebreaks).
- `removed === 0 ⇒ fail + refund` (never bill a no-op).

---

## 12. Open risks / [VERIFY]

- **`seg.combined` silhouette-vs-sparse-union** (§2) — unmeasured; gates trusting v2. The parked fork in `docs/ARCHITECT_DECISION_DENSITY_FIXES.txt`.
- **v2 `boundaryRaster ?? raster` fallback** silently widens the compositing clip to the full crop on a degenerate boundary (Fix 3).
- **Small-n granularity:** `round(n·pct)` is coarse for few motifs (e.g. n=3 @ 50% → countError 0.17 fails) — a known floor for sparse prints.
- **Scale detector under-calibrated** (repeatDetector thresholds are starting points) — adjacent to density, not density itself.
- **Don't-flip gate:** `STUDIO_DENSITY_REDISTRIBUTE` should stay dark until the empirical `seg.combined` measurement (V4) is in hand.

---

*Extracted by Claude Code — read-only, file:line-cited against `main` @ 8a83483.*
