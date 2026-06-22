# Print Studio — SCALE & DENSITY Operations Specification

**Repo:** `astersports/astersports-web` · **Status:** as-implemented contract (verified against source).
**Audience:** builders, reviewers, the Architect (flip authority). This is the **contract**: behavior must match the formulas and guards below; deviations require an Architect-signed amendment.

Both ops are **deterministic** (no model call, no RNG except seeded PRNGs, no wall-clock) and **formula-driven**. Both honor an **effect-based no-op→refund** contract: a job that produces no real change is failed and refunded, never billed.

---

## 1. Shared substrate

Both ops operate on a single decoded RGBA frame and a **SAM2 fabric segmentation**:

- **Decode boundary.** The source image is decoded exactly once through `decodeUpright` (the single orientation/coordinate boundary). All raster math is in that one coordinate frame; output dims always equal input dims.
- **Fabric mask (raster).** A per-pixel raster where pixels `> 127` mark fabric. Required (`rasterReady` provider = SAM2). A bbox-only mask is rejected — both ops need the raster to avoid touching the garment/background.
- **Instances (density only).** Per-motif instance masks (rasters + bboxes) from the same segmentation.
- **Resource guards.** Megapixel cap (`STUDIO_MAX_MEGAPIXELS`, default 40 MP) and decode-concurrency cap (`STUDIO_MAX_CONCURRENT_DECODES`, default 4); SSRF-guarded fetches for any remote image/mask.
- **Determinism.** All randomness is a seeded `mulberry32` (seed 1). Same input ⇒ byte-identical output across runs.

Both ops live entirely inside the fabric region: pixels where the feathered fabric alpha is 0 are **byte-identical** to the source (garment, background, and any masked-out notch are frozen).

---

## 2. SCALE — change the print **repeat density** (motif size within a fixed garment)

**Intent.** Make the printed motifs larger (fewer repeats) or smaller (more repeats) **without** changing the garment shape or the fabric region's footprint. The bbox dimensions stay fixed; only the *content scale* inside it changes.

**Input.** `scale.percent ∈ [SCALE_MIN, SCALE_MAX] = [−50, +100]` (UI steps −50…+50 by 10).
**Fraction.** `f = (100 + scale.percent) / 100` (e.g. −50 ⇒ 0.5 shrink, +30 ⇒ 1.3 enlarge).

**Algorithm (`scaleRepeat.ts::scalePrintRepeat`):**
1. **Bbox.** Pixel bbox of the **largest connected component** of fabric pixels `> 127` (speck-denoise — a disconnected SAM2 island can't inflate the bbox and skew the resample/crop/tile geometry): `bw = xmax−xmin+1`, `bh = ymax−ymin+1`. Empty mask / no component ⇒ passthrough, `changed:false`. On a clean single-component mask this equals the global min/max extent.
2. **Resample dims.** `rw = max(1, round(bw·f))`, `rh = max(1, round(bh·f))`.
3. **Resample.** `sharp.resize(rw, rh, { kernel: "lanczos3" })` — pinned 3-lobe Lanczos (windowed sinc), for determinism.
4. **Refill the original bbox** (dims fixed):
   - `f > 1` (enlarge) → **center-crop**: `extract({ left: floor((rw−bw)/2), top: floor((rh−bh)/2), width: bw, height: bh })`.
   - `f < 1` (shrink) → **mirror/reflect tile** to fill (`tile.ts::mirrorTileToSize`, alternating flipped tiles).
   - `f === 1` → no resample (passthrough).
5. **Blend.** Composite the refilled bbox into a full-frame copy; feather the binary fabric mask with `blur(1)` (≈1 px) into per-pixel alpha `a`; `out = buf + (scaledFull − buf)·a` per RGB; alpha channel preserved; `a ≤ 0` ⇒ byte-identical.

**Effect flag.** `changed = (rw !== bw || rh !== bh)`. This is **effect-based, not intent-based**: a near-unity fraction on a small motif can round back to identity (`round(64·1.001) === 64`) — that is a **no-op** and must refund.

**Guards (pre-deduct):**
- **Repeat guard** (`repeatGuard.ts::checkRepeat`, biased autocorrelation, `MIN_REPEAT_CONFIDENCE = 0.2`, per-axis): if the print is not a detectable repeat, throw `NON_REPEAT_SCALE_ERROR` → refund (scaling a non-repeating/placed graphic is undefined).
- **DPI guard** (`dpiGuard.ts`, enlarge only): if `effectiveDpi = sourceDpi/f < MIN_EFFECTIVE_DPI (150)`, reject pre-deduct. `density === 72` is treated as the "unknown DPI" sentinel → **warn-only** (known false-negative — a genuinely 72-DPI source upscaled hard only warns).

**Refund contract.** `generateScaledImage` throws `NO_OP_SCALE_ERROR` on empty raster or `changed === false`, and `NON_REPEAT_SCALE_ERROR` on a non-repeat. The caller refunds; scale **never** falls back to a generative result.

**Dependency.** SCALE requires the SAM2 raster provider (`rasterReady`). With the classical provider it cannot run deterministically (see §6).

---

## 3. DENSITY — change **how many** motifs are present (areal density), motif size unchanged

**Intent.** Thin the print by removing a percentage of motifs (`densityThin`), or — in the dark v2 — remove then evenly redistribute the survivors (`densityRedistribute`). Motif **size and orientation are preserved**; only the count/placement changes. This is an *areal-density* operation (motifs per unit area), not a spatial-period or coverage-fraction operation.

**Input.** `density.percent ∈ [DENSITY_MIN, DENSITY_MAX] = [0, 90]`.
**Count (both paths).** `n = instances.length`; `removeN = clamp(round(n · percent / 100), 0, n)`. There is **no spacing/period target** — density is purely a count operation. (`densityRedistribute` also clamps `percent` to `[0, 90]` first, then `M = n − removeN`; invariant `removed + kept === n`, target areal density `ρ' = (1−p)·ρ`.)

> DENSITY calls **no** repeat detector. Repeat detection is a SCALE concern only.

### 3.1 `densityThin` — the live path (instance erasure)
1. **Select `removeN` instances** via `stratifiedSelect` — deterministic **farthest-point removal with an edge penalty** (no RNG):
   - centroids normalized to the fabric bbox; interiority weight ramps `0.3` (at edge) → `1.0` at `EDGE_MARGIN = 0.12` inside;
   - seed = the instance nearest the fabric center `(0.5, 0.5)`;
   - greedily pick the instance with the **largest** weighted (`minDist · interiority`) distance to already-selected removals; **ties → lower instance index**.
   - Net effect: **edge motifs are preferentially kept** (boundaries are harder to infill); removals are spread out.
2. **Erase.** Selected instances are **dilated 2 px**, clipped to the fabric raster **and** to NOT-any-survivor (survivor-clip), then infilled via `infillBaseCloth({ featherPx: 1, flatten: true })`. Base-cloth color = dominant of **3 LAB k-means** clusters (seed 1) over bare ground. `flatten: true` replaces luminance too (else an opaque motif leaves a ghost); the 2 px dilation covers round-motif under-erase.
3. **Survivors** are restored byte-identical after the infill feather.

**Effect flag (`removed`).** Returns `removed: 0` (→ refund) on any of: 0 instances or `percent ≤ 0`; `removeN === 0` (rounding); instance-raster dimension drift (degrade — avoids bbox over-erase); no bare-ground pixels to sample (can't infill); empty clipped region. Otherwise `removed = selected.length`.

### 3.2 `densityRedistribute` — v2, **DARK** (flag `STUDIO_DENSITY_REDISTRIBUTE`), not on the money path
1. **`M` blue-noise targets** (`blueNoiseLayout`, seed 1): seeded jittered-grid init + **~10 Lloyd/CVT iterations, early-stopped** (not run to convergence, to preserve blue-noise spectral quality); spacing from densest-hex packing `r = 0.75 · sqrt(2A / (sqrt(3)·M))`; `edgeMargin = 0.12`; strided sample `CAP = 20000`; PRNG `mulberry32(seed 1)`.
2. **Survivor↔target assignment** (`assignTargets`): greedy over all (target, source) pairs sorted by squared displacement; **ties by source index then target index** (greedy-nearest; within tolerance of optimal vs. Hungarian).
3. **Render.** Erase ALL `n` originals to base cloth, then composite the `M` survivor crops at their targets — **no resize, no rotate** (size/orientation preserved) — 1 px feather, clipped to the fabric raster.
4. Same F1/F2/F3 degrade→refund guards as `densityThin` (including dim-drift → refund).

**Refund contract.** `generateDensityImage` / `generateDensityRedistributeImage` return `null` on degrade (no/empty raster, 0 instances) or `removed === 0`; `runVariation` throws on null → caller refunds. Density **never** falls back to a generative result (the generative path cannot honor a count-based ask).

---

## 4. Billing & refund contract

`computeCredits` (`shared/controls.ts`) with `CREDIT_COST` (`standardGeneration = 10`, `combinedControls = 15`, `extraVariation = 10`):
```
active = [ scale.enabled  && scale.percent  !== 0,
           density.enabled && density.percent > 0,
           /* + any other enabled ops */ ].filter(Boolean).length
if (active === 0) return 0
base  = active > 1 ? 15 : 10
extra = max(0, variations − 1) · 10        // variations clamped to 1 ⇒ dormant
return base + extra
```
- A control at a **no-op value** (scale 0%, density 0%) does **not** count as active → not billed.
- **Run-time:** the deduct is per-attempt (unique `job-<id>-aN` refId; idempotent on `(refId, reason)`); on any no-op/degrade the op throws/returns null and the caller issues an idempotent refund keyed to that attempt. A byte-identical result is a **fail+refund**, never a charge.
- Coverage: the credit primitives (atomic conditional debit, `(refId,reason)` idempotency, no-oversell under concurrency) are enforced by a real-MySQL integration suite (`creditLedger.integration.test.ts`, `db-integration` CI job).

---

## 5. Determinism guarantees

- No model call, no `Math.random()`/clock in either op path; all randomness is `mulberry32(seed 1)` (blue-noise, k-means).
- All tie-breaks are explicit and index-based (`stratifiedSelect` lower-index, `assignTargets` source-then-target).
- The Lanczos3 kernel is pinned. **Caveat:** exact output bytes depend on the sharp/libvips version — pin sharp and treat golden output-hash tests as version-coupled; prefer **invariant** assertions (border-identical, output dims, `changed`/`removed`, deterministic selected-index set) for cross-environment stability.

---

## 6. Operational gating & live-flip sequence (Flip Authority)

Both ops are **dark by default** and gated by env flags; flipping any of these is the Architect/Frank's by-hand action (CLAUDE.md §1), never a builder/PR action:

| Flag (default) | Effect |
|---|---|
| `STUDIO_MASK_PROVIDER` (`classical`) | `sam2` enables the raster provider that SCALE and DENSITY require (`rasterReady`). |
| `STUDIO_SCALE_LIVE` (false) | Routes scale-only jobs to `scalePrintRepeat` (requires `rasterReady`). |
| `STUDIO_DENSITY_LIVE` (false) | Routes density-only jobs to `densityThin`. |
| `STUDIO_DENSITY_REDISTRIBUTE` (false) | Routes density to v2 `densityRedistribute` (dark). |

**Hard dependency / sequencing.** With the default flags, neither op runs deterministically — jobs route to the generative fallback. Therefore the deterministic ops only become the working path **after** the flip sequence, in order, per CLAUDE.md §1 (G0 prod-env verified dark → G1 SHA verified → **G2 SAM2 privacy** → G3 real-garment per-route eval → G4 live-surface hardening): money path → **`STUDIO_MASK_PROVIDER=sam2`** (G2) → `STUDIO_SCALE_LIVE` (G3) → `STUDIO_DENSITY_LIVE` (G3). (Recolor/remove were retired in the two-op reduction, so they are no longer in the sequence.) **Any plan that removes the generative fallback must come AFTER scale+density are live in prod**, or the editor has no working op.

---

## 7. Known limitations & accepted deviations

1. **Repeat taxonomy is axis-separable only.** The wired SCALE repeat guard (and the dark FFT detector) test x/y periodicity independently — they detect straight/allover repeats but **not** half-drop, brick, or diagonal/ogee rapports, which may misclassify as border/placement and be refused. Document for the garment catalog; extend with cross-axis phase tests only if those rapports are in scope.
2. **FFT detector is dark/calibration-only.** `repeatDetector.ts` (FFT-propose + autocorrelation-validate) is **not** on any billed path; its thresholds (`PEAK_RATIO=0.30`, `PERIODICITY_ENERGY=0.50`, `MIN_HARMONIC_PEAKS=2`, `MIN_TILE_REPEATS=2.5`, `AUTOCORR_CONFIRM=0.25`) are explicit **calibration starting points**, not frozen constants. Calibrate on a labeled set before ever wiring it; only switch from `repeatGuard` if it wins on precision/recall.
3. **`peakRatio` is mislabeled** in the dark detector: it computes peak ÷ **mean** spectral energy (post DC-removal), while the JSDoc/type say "peak-to-DC." Doc/contract fix only (the formula is intentional); fix before any calibration anchors thresholds to that name.
4. **O(N²) DFT** in the dark detector is deliberate (correctness/simplicity for 500–2000-sample signals), not a true FFT — acceptable for a pre-deduct guard.
5. **DPI `density === 72` sentinel** is a known false-negative (a real 72-DPI source upscaled hard only warns). Switch to reading the JFIF density unit if print-quality complaints arise.

---

## 8. Constants reference

| Parameter | Value | File |
|---|---|---|
| Scale fraction | `f = (100+percent)/100` | studioEngine.ts |
| Scale range | `SCALE_MIN=−50`, `SCALE_MAX=100` | controls.ts |
| Resize dims | `rw=max(1,round(bw·f))`, `rh=…` | scaleRepeat.ts |
| Kernel | `lanczos3` (pinned) | scaleRepeat.ts |
| Enlarge / shrink refill | center-crop / mirror-tile | scaleRepeat.ts, tile.ts |
| Mask feather | `blur(1)` ≈1 px | scaleRepeat.ts |
| Scale repeat guard | biased autocorr, `MIN_REPEAT_CONFIDENCE=0.2` | repeatGuard.ts |
| DPI guard | `MIN_EFFECTIVE_DPI=150`; `72`=unknown→warn | dpiGuard.ts |
| Density range | `DENSITY_MIN=0`, `DENSITY_MAX=90` | controls.ts |
| Density count | `removeN=clamp(round(n·percent/100),0,n)` | densityThin/Redistribute |
| Stratified select | `EDGE_MARGIN=0.12`, interiority 0.3→1.0, seed=nearest-center, dilate 2 px, tie by lower index | stratifiedSelect.ts, densityThin.ts |
| Infill base cloth | `featherPx:1`, `flatten:true`, 3-LAB-kmeans seed 1 | densityThin.ts, infill.ts |
| Blue-noise (dark) | Lloyd≈10 early-stop, `eps=0.75`, `edgeMargin=0.12`, `CAP=20000`, mulberry32 seed 1 | blueNoiseLayout.ts |
| Credits | 10 single / 15 combined; no-op = 0 | shared/controls.ts, shared/billing.ts |
