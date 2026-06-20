# Scale & Density — eval-metric specs (draft)

**Date:** 2026-06-20 · **Branch:** `claude/jolly-pascal-k9tw4r`
**Status:** spec only. Decision-free to draft now (like the recolor metrics, which
were built ahead of wiring). Implement once the magnitude-semantics ruling lands
and the op exists. Mirrors the proven recolor eval (`server/_core/studio/eval/`).

## Shared principles (inherited from recolor eval — already validated)

1. **Op-agnostic.** Metrics score the OUTPUT vs the INPUT, never the op's
   internals, so they don't drift with the op implementation.
2. **SAM2 truth-mask decoupling.** The op runs at the floor (bbox); the metric
   classifies against a SAM2 **truth mask** passed per case. Scoring against the
   op's own membership makes background signals structurally blind (proven on
   recolor). Without a truth mask, mask-dependent metrics print `blind` and are
   not counted as evidence.
3. **Op-correctness vs mask-signal split.** `verdict.pass` = op-correctness
   metrics only. Background/pose bleed onto truth-background is the **mask/D1
   signal** (drives RASTER-NEEDED) and is **excluded** from `pass` — it's the tier
   decision, not op correctness. Same shape as recolor's `offBg` vs `offFab`.
4. **Determinism.** Byte-identical on re-run for the deterministic core. A
   generative relight/infill pass breaks byte-determinism unless seeded — report
   it separately and gate that pass behind S2's seed finding.
5. **PNGs are primary** for interpretation; a single scalar near threshold is not
   evidence (the blue-amber rim-vs-patch lesson).

## Reusable harness assets
`decodeUpright`, the truth-mask loader, side-by-side PNG writer, `color.ts`
(LAB/ΔE2000), `kmeans.ts`, and the manifest/runner shape all carry over. New
metric modules sit beside `recolorEval`:
`server/_core/studio/eval/scaleMetrics.ts`, `densityMetrics.ts`, with
`scaleEval.ts` / `densityEval.ts` runners.

---

## 1. SCALE eval metrics

Scale rescales the print repeat to `targetFraction = (100 + percent) / 100`
(−50% → 0.5, +30% → 1.3) with the garment frozen. The whole fabric region
changes, so — unlike recolor — we cannot SSIM the fabric; we measure the repeat
period, the palette, and everything OUTSIDE the print.

| Metric | Definition | Method | Bucket | Pass |
|---|---|---|---|---|
| **scaleRatioError** | Did the motif repeat actually change by the requested factor? | Dominant repeat **period** of the fabric region via 2-D autocorrelation / FFT peak on a luminance (and a*) channel, in vs out. `measuredFraction = period_out / period_in`. Error = `|measuredFraction − targetFraction| / targetFraction`. | **op** | ≤ 0.15 |
| **paletteDeltaE** | Same inks, just smaller — no invented colors. | k-means centroids (k≈5) on fabric pixels in vs out; match centroids greedily; mean ΔE2000 of matched pairs. | **op** | ≤ 5 |
| **poseBgDeltaE** | Garment/background frozen; nothing outside the print moved or got rescaled. | mean ΔE2000 (in vs out) over **truth-background** pixels (`truth==0`). | **mask/D1** (RASTER-NEEDED) | ≤ 2 |
| **determinism** | Composite reproducible. | byte-compare two runs (composite-only). | report | — |

`verdict.pass = scaleRatioError && paletteDeltaE`. `poseBgDeltaE` is the raster
signal: a bbox composite rescales any background the bbox swept in → fails → the
precise mask fixes it by construction. With the generative relight ON, a
`poseBgDeltaE` failure could instead be the relight moving the garment — **read
the PNG** before attributing it (D2/relight vs mask), exactly as recolor splits
offBg/offFab.

**Notes / edge cases**
- Autocorrelation period needs a roughly periodic print; for sparse/non-repeating
  motifs, fall back to **mean connected-component motif area ratio** (in vs out)
  via the truth instance masks (shared with density). Report which estimator ran.
- Directionality: shrink → shorter period (fraction < 1); enlarge → longer
  (fraction > 1). The estimator must handle both; assert on a synthetic grid.
- "Garment not rotated" is covered by `poseBgDeltaE` (a moved garment changes the
  truth-background region). A dedicated silhouette IoU (fabric region in vs out)
  can be added if relight drift shows up.

**Test plan (synthetic, no network):** a tiled-dot fabric region on a flat
background; rescale by 0.5 and 1.3; assert measuredFraction within 15%, palette
ΔE≈0, poseBg≈0 when background is excluded by truth mask, and `blind` when it isn't.

---

## 2. DENSITY eval metrics

Density removes `X%` of motif instances evenly and infills with ground color,
survivors untouched. Needs **truth instance masks** (SAM2 automatic masks) — a
heavier ground truth than scale/recolor (region mask only).

| Metric | Definition | Method | Bucket | Pass |
|---|---|---|---|---|
| **countError** | Did the motif count drop by X%? | Over truth instances, mark an instance **removed** if its region in `out` now matches the local ground color (mean ΔE2000 to sampled inter-motif ground ≤ τ). `measuredRemoval = removed / total`. Error = `|measuredRemoval − X/100|`. | **op** | ≤ 0.10 |
| **survivorIntegrity** | Survivors unchanged in place, scale, color. | For non-removed truth instances: mean ΔE2000 (in vs out) over their pixels. | **op** | ≤ 2 |
| **evenness** | Removed motifs spread evenly, not clustered. | Removed-instance centroids vs a uniform expectation: quadrant-count balance + nearest-neighbour distance variance ratio vs Poisson. | **op** | within tol (tune) |
| **infillCleanliness** | Erased regions read as bare ground, no motif ghosts. | residual edge energy (gradient magnitude) inside removed-instance regions vs surrounding bare-ground baseline. | **op** | ≤ baseline×k |
| **bgDeltaE** | Background/garment untouched. | mean ΔE2000 (in vs out) over **truth-background** pixels. | **mask/D1** (RASTER-NEEDED) | ≤ 2 |
| **determinism** | Selection + erase reproducible. | seeded even-selection RNG + deterministic infill → byte-compare. (Generative infill breaks this — report.) | report | — |

`verdict.pass = countError && survivorIntegrity && evenness && infillCleanliness`.
`bgDeltaE` is the raster signal.

**Notes / edge cases**
- `countError` and `survivorIntegrity` both depend on the **truth instance masks**;
  the eval is only as good as the SAM2 instance segmentation — report instance
  count and flag low-confidence instances rather than silently miscounting.
- Removed-detection threshold τ: sample the ground color from the median of
  inter-motif fabric (between truth instances), per image — don't hardcode.
- Overlapping/touching motifs (the skirt's beaded clusters) are the hard case for
  instance counting; surface ambiguous instances, don't average them away.

**Test plan (synthetic):** N synthetic motifs on a flat ground with a provided
instance mask; remove 30%; assert measuredRemoval≈0.30, survivors ΔE≈0, infill
residual≈ground baseline, evenness within tol, determinism holds.

---

## Open semantics questions for the Architect (park until the op spec)

- **Density "delete X%" basis:** count over **distinct motif instances** (recommended)
  vs fabric **area**? And the even-selection method (Poisson-disk / blue-noise vs
  stratified grid) — fixes `evenness`'s expectation model. (This is the density
  analog of the coverage ruling.)
- **Scale estimator:** is autocorrelation-period the primary `scaleRatioError`
  estimator, with motif-area-ratio as the sparse-print fallback — or invert them?
- **Relight/infill determinism:** both metrics assume a deterministic core with an
  optional generative finish. Confirm the finish pass is gated behind S2's seed
  result and scored separately (composite-only must pass first).

## Status
Specs only. `metrics.ts` for recolor stands unchanged. These slot in beside it
when the scale/density ops land — after D1 flips `rasterReady` and the
magnitude-semantics rulings are issued. Pure-function metric modules are
unit-testable on synthetic data ahead of the ops (as recolor's were); say the
word and I'll implement the metric functions + tests now, with wiring deferred.
