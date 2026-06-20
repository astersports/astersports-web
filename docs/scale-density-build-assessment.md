# DEPRECATED — Superseded by `docs/STUDIO_OPS_SPEC.md`

> This document is retained for historical reference only. Its wiring-gap table is stale (all items listed as missing are now built and merged on `main`). The canonical source of truth for Scale and Density semantics, algorithms, acceptance thresholds, and live-wiring rules is **`docs/STUDIO_OPS_SPEC.md`**.

---

# Scale & Density Deterministic Build Assessment

**Date:** 2026-06-20  
**Assessor:** Manus AI (on behalf of the Architect lane)  
**Status:** DEPRECATED  
**Scope:** Evaluate the current state of the deterministic Scale and Density ops on Manus `main` at checkpoint `83559a42` — implementation quality, test coverage, eval-gate readiness, production-wiring gaps, and alignment with Claude's locked live-wiring spec (`docs/scale-density-live-wiring-spec.md`).

---

## Executive Summary

Both the Scale (`scaleRepeat.ts`) and Density (`densityThin.ts`) deterministic ops are **fully implemented, well-tested, and eval-gated** on Manus main. They are architecturally sound, deterministic, and covered by principled metric harnesses that separate op-correctness from mask-quality signals. However, **neither is router-wired to the production money path** — the live routing code specified in Claude's D-A through D-D rulings has not been built yet. The privacy gate substrate (SAM2 crop-to-fabric + fail-safe) that these ops depend on for production is in place, but the consumer wiring that connects it to the `generate` mutation is absent.

The builds are ready for the **next phase**: live-wiring behind `STUDIO_SCALE_LIVE` / `STUDIO_DENSITY_LIVE` flags, followed by real-garment eval and flag flip.

---

## 1. Scale Op (`scaleRepeat.ts`)

### 1.1 Architecture

The Scale op implements a **mirror-tile resample** strategy: it extracts the fabric bbox region, resizes it by the target fraction using Sharp's `lanczos3` kernel, then refills the original bbox with the resized content. For shrink operations (fraction < 1), the resized patch is mirror-tiled to fill the bbox seamlessly. For enlarge operations (fraction > 1), the resized patch is center-cropped back to the bbox dimensions.

The result is composited onto the original image using a feathered fabric mask (1px Gaussian blur on the binary raster), ensuring the garment silhouette and background remain byte-identical outside the fabric region.

### 1.2 Strengths

The implementation demonstrates several strong design choices. It requires a full raster mask (`rasterReady` provider) and throws a clear error when only a bbox is available, preventing silent background contamination. The mirror-tile strategy (`tile.ts`) eliminates hard seams at tile boundaries by flipping alternate columns and rows — a standard textile repeat technique. The 1px feathered blend at the mask boundary prevents aliasing artifacts without introducing visible softness. The op is fully deterministic: identical inputs produce byte-identical outputs across runs.

### 1.3 Concerns and Limitations

The op header explicitly acknowledges several deferred capabilities: **drape-follow displacement warp** (for on-body/hanging garments), **placed-graphic/non-repeating prints** (where tiling is semantically wrong), **tile-boundary lighting-seam cleanup**, and **generative relight**. These are appropriate deferrals for a v1, but they define the failure modes users will encounter:

- A placed graphic (e.g., a single large logo) will be mirror-tiled when shrunk, producing nonsensical repetition.
- On-body garment photos will show flat-lay scaling that ignores fabric drape and fold shadows.

The `baseClothLab` parameter is accepted but unused in the current implementation — it exists as a forward-compatible anchor for future boundary cleanup.

### 1.4 Test Coverage

| Test | What it validates |
|------|-------------------|
| Shrink to 0.5 | Period halved (scaleRatioError ≤ 0.15), palette preserved (ΔE ≤ 5), garment frozen |
| Enlarge to 1.3 | Period increased, palette preserved, garment frozen |
| Fraction == 1 | Passthrough (max pixel diff ≤ 2 inside mask) |
| Notched silhouette | Masked-out region keeps original pixels |
| Determinism | Byte-identical across two runs |
| Missing raster | Throws clear error message |

Coverage is adequate for the op's contract. The tests use a synthetic periodic dot-grid scene with known period, making the autocorrelation metric reliable.

---

## 2. Density Op (`densityThin.ts`)

### 2.1 Architecture

The Density op removes a specified percentage of motif **instances by count** (not area), selected via deterministic stratified subset selection (`stratifiedSelect.ts`), then erases each selected instance using the base-cloth infill primitive (`infill.ts` with `flatten: true`). The removal region is dilated by 2px and clipped both to the fabric raster and away from surviving instances (the "survivor-clip" invariant), ensuring survivors remain byte-identical even when adjacent to a removed motif.

### 2.2 Strengths

The stratified selection algorithm is the standout design element. It grids the fabric bbox into cells sized proportional to `removeN`, buckets instances by centroid, sorts within each cell by distance to cell center, then round-robins across cells in row-major order. This guarantees spatial evenness without randomness — the same inputs always select the same subset, and the selection is visually distributed rather than clustered.

The two documented spec deviations are well-reasoned and explicitly flagged:
1. **`flatten: true` infill** — necessary because L-preserving erase leaves a luminance ghost on opaque motifs whose lightness differs from the cloth (e.g., pink flowers on black fabric). The deviation is demonstrated by the metric: without it, `densityMetrics` reads 0 removed instances.
2. **2px dilation** — ensures round motifs sit fully inside the infill feather core. Without it, the 1px feather under-erases curved edges.

The survivor-clip logic (lines 101–108) is a critical correctness invariant: the dilated removal region is AND-masked against NOT-survivors, so dilation can never bleed into an adjacent surviving motif.

### 2.3 Concerns and Limitations

The op requires **instance-level raster masks** from the SAM2 provider. If SAM2 returns poor instance segmentation (merged motifs, split motifs, or missed motifs), the op's count accuracy degrades proportionally. The `countError ≤ 0.10` threshold assumes SAM2's instance segmentation is reliable — this is the primary quality dependency that real-garment eval must validate.

The `baseClothAnchor` function samples the dominant LAB cluster of bare ground (in-fabric, not covered by any instance). On garments with very little visible ground between motifs, the sample may be noisy or biased. The k-means with k=3 and seed=1 is deterministic but may not capture the true ground color if the fabric has multiple distinct ground regions (e.g., a gradient).

### 2.4 Test Coverage

| Test | What it validates |
|------|-------------------|
| 30% removal (R1/R2) | Correct count (11/36), countError ≤ 0.10, survivorIntegrity ≤ 2, evenness pass |
| Survivor byte-identity | A non-selected motif's center pixel is unchanged |
| Determinism | Byte-identical across two runs |
| Passthrough (percent=0, empty instances) | Returns original unchanged, removed=0 |
| Missing raster | Throws clear error |
| Survivor-clip regression | Adjacent survivor stays byte-identical despite 2px dilation |
| stratifiedSelect: 4 picks | One per quadrant on a 4×4 grid |
| stratifiedSelect: 8 picks | Distinct, deterministic, spatially spread |
| stratifiedSelect: overflow | Returns all when removeN ≥ n |

Coverage is strong. The survivor-clip regression test specifically constructs two motifs 18px apart (within dilation reach) and verifies zero changed pixels on the survivor — this is the critical edge case.

---

## 3. Eval Metrics Layer

### 3.1 Scale Metrics (`scaleMetrics.ts`)

The Scale eval uses **autocorrelation-based period estimation** as the primary scale measurement, with a motif-area-ratio fallback for sparse/non-periodic prints. The metric computes:

- `scaleRatioError` — |measured − target| / target (threshold: ≤ 0.15)
- `paletteDeltaE` — k-means palette comparison in LAB (threshold: ≤ 5)
- `poseBgDeltaE` — background change (threshold: ≤ 2, **excluded from pass**)

The exclusion of `poseBgDeltaE` from the pass verdict is a deliberate architectural decision: a bbox-based composite will always rescale some swept-in background pixels; only a precise raster mask fixes this. The metric reports it as a **D1/mask-quality signal**, not an op failure.

### 3.2 Density Metrics (`densityMetrics.ts`)

The Density eval scores against truth instance labels and computes:

- `countError` — |measured removal fraction − target| (threshold: ≤ 0.10)
- `survivorIntegrity` — mean ΔE2000 over surviving-instance pixels (threshold: ≤ 2)
- `evenness` — index of dispersion of removed centroids over a K-cell grid (threshold: ≤ 1.5)
- `infillCleanliness` — residual edge energy in removed regions vs bare-ground baseline (threshold: ≤ 2.5)
- `bgDeltaE` — background change (threshold: ≤ 2, **excluded from pass**)

The `removedTau` parameter (default 5 ΔE) defines when a motif is considered "erased" — its mean color must be within 5 ΔE of the ground color. This is the acceptance criterion that drove the `flatten: true` deviation.

### 3.3 Missing: Scale/Density Eval Runners

Unlike recolor (which has `recolorEval.ts` as a runnable CLI harness), **there are no equivalent eval runner scripts for Scale or Density**. The metric modules exist and are unit-tested, but there is no `scaleEval.ts` or `densityEval.ts` that:
- Loads a manifest of real garment cases
- Runs the op against each case
- Scores with the metric module
- Produces side-by-side PNGs and aggregate pass rates

This is a **production-readiness gap** — the eval gate cannot be exercised on real garments without building these runners.

---

## 4. Production Wiring Gap Analysis

### 4.1 Current State vs. Required State

| Component | Recolor (reference) | Scale | Density |
|-----------|-------------------|-------|---------|
| Deterministic op | `separationRemap.ts` ✅ | `scaleRepeat.ts` ✅ | `densityThin.ts` ✅ |
| Eval metric module | `metrics.ts` ✅ | `scaleMetrics.ts` ✅ | `densityMetrics.ts` ✅ |
| Eval runner (CLI) | `recolorEval.ts` ✅ | **MISSING** ❌ | **MISSING** ❌ |
| Live env flag | `STUDIO_RECOLOR_LIVE` ✅ | **MISSING** ❌ | **MISSING** ❌ |
| Router wiring (generate) | Lines 149–227 ✅ | **MISSING** ❌ | **MISSING** ❌ |
| Helper function (aiEngine) | `generateRecoloredImage` ✅ | **MISSING** ❌ | **MISSING** ❌ |
| D-A combined-control rejection | N/A (recolor combines freely) | **MISSING** ❌ | **MISSING** ❌ |
| D-B rasterReady fallback WARN | N/A | **MISSING** ❌ | **MISSING** ❌ |
| D-C no-op billing guard | N/A (op always applies) | **MISSING** ❌ | **MISSING** ❌ |
| Real-garment eval pass | pink→navy PASS ✅ | **NOT RUN** ❌ | **NOT RUN** ❌ |
| Privacy gate (SAM2 substrate) | N/A (uses classical) | `sam2Provider.ts` ✅ | `sam2Provider.ts` ✅ |
| Fail-safe wrapper | N/A | `masking/index.ts` ✅ | `masking/index.ts` ✅ |

### 4.2 What Needs to Be Built (per Claude's Spec)

The locked live-wiring spec (`docs/scale-density-live-wiring-spec.md`) defines four decisions (D-A through D-D) that must be implemented in the router:

**D-A: Combined-control rejection.** When `STUDIO_SCALE_LIVE` (or `STUDIO_DENSITY_LIVE`) is ON and the provider is `rasterReady`, a job that includes scale/density alongside any other edit must be rejected with `BAD_REQUEST` ("Scale/Density can't yet combine with other edits — run them separately"). This is pre-deduct validation.

**D-B: rasterReady-false fallback.** If a `*_LIVE` flag is ON but the provider isn't `rasterReady` (misconfig or SAM2 down), fall back to the prompt path and WARN with job_id + org_id. The fail-safe substrate in `masking/index.ts` already handles the provider-level degradation, but the router-level WARN and prompt-path fallback branch is not wired.

**D-C: No-op billing guard.** The op throws on degenerate masks (`removed === 0` for density, empty fabric raster for scale). The router must catch these throws and fire the existing refund path — no paid no-op.

**D-D: The live helper functions.** Two new functions analogous to `generateRecoloredImage`:
- `generateScaledImage(originalUrl, { targetFraction })` — resolves URL, gets SAM2 fabric mask, calls `scalePrintRepeat`, encodes to PNG.
- `generateDensityImage(originalUrl, { percent })` — resolves URL, gets SAM2 fabric mask + instance masks, calls `densityThin`, encodes to PNG.

### 4.3 Env Flag Gap

The current `env.ts` defines `studioDeterministicScale` and `studioDeterministicDensity` as **eval-only** toggles. The spec requires separate **live** flags (`STUDIO_SCALE_LIVE`, `STUDIO_DENSITY_LIVE`) that control the production money path, distinct from the eval toggles. These do not exist yet.

---

## 5. Legacy `hybridScale.ts` — Status and Recommendation

A separate `hybridScale.ts` (508 lines) exists from an earlier iteration. It implements a different approach: SAM2 segments individual motifs via Replicate's raw mask URLs, downloads each mask, resizes each motif independently, and composites onto a background-filled canvas. This is architecturally different from `scaleRepeat.ts` (which resizes the entire fabric region as a repeat unit).

The legacy pipeline has several issues:
- It downloads mask images from Replicate URLs (external fetch per mask) — fragile and slow.
- It uses `Date.now()` in the storage key — non-deterministic.
- It does not use the privacy-gated SAM2 provider (no crop-to-fabric, no audit logging).
- Its test coverage is shallow (token validation, boolean routing, math — no actual image processing).

**Recommendation:** `hybridScale.ts` should be considered **superseded** by `scaleRepeat.ts`. It may have value as a reference for per-motif scaling (placed graphics), but it should not be the production path for repeating prints.

---

## 6. Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| SAM2 instance segmentation quality on real garments | **High** | Run real-garment eval before flipping flags; the D-B fallback ensures no user-facing failure |
| Placed graphics (non-repeating) scaled via mirror-tile | **Medium** | Document as a known limitation; future: detect repeat vs. placed via LLM |
| On-body photos (drape/fold) treated as flat-lay | **Medium** | The op header acknowledges this; v2 requires displacement warp |
| Ground color sampling noise on dense prints | **Low** | k-means with k=3 is robust for most fabrics; edge case for gradients |
| Two-tree divergence blocking deployment | **High** | Resolve before building live wiring (see Section 7) |

---

## 7. Recommended Next Steps (Priority Order)

1. **Resolve the two-tree divergence.** Claude's branch has the locked spec docs; main has the privacy gate. Option C (cherry-pick the 2 spec docs onto main, close PR #1) is the cleanest path since all code is already on main.

2. **Build Scale/Density eval runners.** Create `scaleEval.ts` and `densityEval.ts` following the `recolorEval.ts` pattern — manifest-driven, side-by-side PNGs, aggregate pass rates, SAM2 truth masks.

3. **Run real-garment eval.** Use `black-floral-skirt.jpg` (already has a SAM2 truth mask) as the first Scale/Density eval case. This validates SAM2 instance quality on a real garment.

4. **Build the live wiring (D-A through D-D).** Add `STUDIO_SCALE_LIVE` / `STUDIO_DENSITY_LIVE` flags, `generateScaledImage` / `generateDensityImage` helpers, router branches with combined-control rejection, rasterReady fallback WARN, and no-op refund catch.

5. **Flip flags sequentially.** Scale first (simpler — no instance masks needed for the fabric raster), then Density (requires instance masks from SAM2).

---

## 8. Conclusion

The deterministic Scale and Density builds represent solid engineering work. The ops are well-designed, deterministic, and covered by principled eval metrics that correctly separate op-correctness from mask-quality signals. The privacy gate substrate they depend on is already deployed. The primary gap is the **live-wiring layer** — the router code that connects these ops to the production money path with proper guards (D-A through D-D). Once the eval runners are built and real-garment eval passes, the live wiring is a mechanical exercise following the established A2 recolor pattern.

**Build quality verdict: READY FOR LIVE WIRING PHASE.**
