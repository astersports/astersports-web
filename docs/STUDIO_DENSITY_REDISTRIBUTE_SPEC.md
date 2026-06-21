# SPEC — Studio Density v2: Proportional Redistribution (**Option B**)

**Repo:** `astersports/astersports-web` · **Area:** `server/_core/studio/` · **Verified against commit `55577c7`** (SHAs in §10).
**Executor:** Claude Code (chat) or Crostini (terminal) — §1 protocol is identical for both.
**Status:** DARK. New op + new flag, not router-wired. Implementation shipped dark in #16; **the flag is not flipped.**

> **Status (as merged).** This spec is merged as the **record** for Density v2. Its **deterministic core** (the §2–§7 composite path) shipped **dark** in **#16** (`STUDIO_DENSITY_REDISTRIBUTE` default off, not router-wired). The **generative-render** alternative noted in D1 / §8 is **deferred** and stays gated on the SAM2 provider flip (G2 privacy) + a real-garment per-route eval (G3). The open review threads on this PR track that deferred path's safety requirements and are intentionally left open for it. Merging this doc flips nothing.

## 0. Governance (non-negotiable — this repo had a live-flag incident; `CLAUDE.md` governs)
1. **Branch, never `main`.** `feat/density-redistribute`. Open a **DRAFT** PR. No merge, no force-push to main.
2. **Your own identity.** Commit as the executing agent. Do **NOT** author as Frank / `admin@legacyhoopers.org`. `Co-Authored-By:` is fine.
3. **Ship dark behind a NEW flag.** `ENV.studioDensityRedistribute` (`STUDIO_DENSITY_REDISTRIBUTE === "true"`, default **off**), patterned on `studioDensityLive`. Not router-wired. Wiring + flip are **Frank's**, after gates.
4. **Don't alter live behavior.** Do not change `densityThin`, `generateDensityImage`, or the `studioDensityLive` path. Edits to existing files are **additive only** and enumerated in §5 — a new `STUDIO_DENSITY_REDISTRIBUTE` flag in `_core/env.ts`, `export computeNNI` in `eval/densityMetrics.ts`, and a new `generateDensityRedistributeImage` entrypoint in `aiEngine.ts`; **no existing function is modified.** Everything else is new files.
5. **Never touch the money path.** No edits to `billing.ts`, `studioDb.ts`, `webhook.ts`, `shadowBilling.ts`. Preserve the count-based refund contract (§4.5). Anything implying a billing change → `TODO(architect)` and stop (Architect-scoped, `CLAUDE.md` §4).
6. **Respect existing guards.** Honor `ENV.studioMaxMegapixels` (40MP decode cap) and `studioMaxConcurrentDecodes` (H6). Thread `Sam2AuditContext` through the new live entrypoint exactly as `generateDensityImage` does (C5).
7. **Eval runs ungated** (Decision 5 in `env.ts`). Do not add an eval flag.
8. **Stay in scope.** Don't fix adjacent findings; list them in the PR body.

## 1. Execution protocol (Claude Code chat or Crostini terminal)
```
git fetch origin && git switch -c feat/density-redistribute origin/main   # re-verify §10 SHAs first
# implement §4 ops + §6 metrics/eval (new files; only additive change to existing code = export computeNNI)
npx tsc --noEmit
npx vitest run server/densityRedistribute.test.ts server/blueNoiseLayout.test.ts \
               server/assignTargets.test.ts server/redistributeMetrics.test.ts
npx tsx server/_core/studio/eval/redistributeEval.ts eval/samples/redistribute.manifest.json
git add -A && git commit -m "feat(studio): density v2 proportional redistribution (dark, behind STUDIO_DENSITY_REDISTRIBUTE)"  # add -A: new files won't be staged by commit -am
git push -u origin feat/density-redistribute && gh pr create --draft   # body = §9 checklist
```
**Definition of done:** typecheck clean; 4 test files pass; eval `verdict.pass` on the synthetic manifest; flag default off; `densityThin`/`generateDensityImage` untouched; PR is a **draft**. **Do not merge. Do not flip the flag.**

## 2. Objective (Option B)
Remove `p%` of motif instances, then **relocate the survivors to an even (blue-noise) layout** so local density is uniform — target areal density `ρ' = (1−p)·ρ`, no holes, no clusters. New invariant: **same motif identity + same scale, new position** (v1's byte-identical-survivor invariant is abandoned). This is a **new op** beside `densityThin`, reusing its primitives. *(The lower-risk alternative — thinning in place via sample elimination — was considered and explicitly not chosen; B is taken to get an even layout regardless of input evenness.)*

## 3. Decisions (defaults; Architect/Frank ratifies)
| ID | Decision | Default |
|----|----------|---------|
| D1 | Render | **Deterministic composite** (cut crops → infill originals → paste at targets). Generative render deferred (reopens privacy gate + replaces the count-refund with the weaker LLM no-op judge). |
| D2 | Target field | **Flat/uniform.** Graded/ombré = a one-parameter variant (§4.2 note). |
| D3 | Orientation | **Preserve** each motif's rotation. |
| D4 | Count | `removeN = clamp(round(p·N),0,N)`, `M = N − removeN`, `clamp(percent,0,90)`. |

## 4. Algorithm
Input mirrors `DensityInput`: `{ image: MaskImageInput; fabric: FabricMask; instances: InstanceMask[]; percent }`. `fabric.raster` (`RasterMask`, 255=fabric, `>127`) REQUIRED, dims == decoded image. Decode via `decodeUpright(input.image.url)`.

**4.1 Count + no-op guards** (parity with `densityThin`). `M = N − removeN`. Return `removed:0` (→ refund) when `N===0 || percent<=0 || removeN===0`. Redistribution triggers only when `removeN > 0` (percent 0 is passthrough — never relocate on a no-removal request).

**4.2 Even target layout — `blueNoiseLayout.ts` (deterministic).** Produce **exactly `M`** blue-noise points inside `fabric.raster`:
- Seed exactly `M` points (deterministic: seeded jittered grid or seeded PRNG matching the `kmeans({seed})` convention; `seed=1`).
- Relax with **Lloyd / centroidal-Voronoi iterations, FIXED small count (≈8–12), terminating EARLY** — do **not** run to convergence (convergence over-regularizes into a lattice and destroys blue noise; see §11). Clip each centroid to the raster; inset by an edge margin (reuse `EDGE_MARGIN=0.12` intent from `stratifiedSelect.ts`).
- **Spacing sanity target:** `r ≈ ε·√(2A/(√3·M))`, `A` = fabric pixel count, `ε ≈ 0.75` (densest-hex packing gives `r_max ≈ 1.075·√(A/M)` at `ε=1`; staying below that keeps the layout even-but-organic, not crystalline).
- **Higher-quality alternatives (optional, note in PR):** oversample a dense Poisson/random set and reduce to exactly `M` via Yuksel weighted sample elimination; or capacity-constrained Voronoi (Balzer) for exact-count blue noise. Default to early-stopped Lloyd for implementability.
- **D2 graded variant:** weight the relaxation centroid by a target density field `τ(x,y)` (CVT-with-density), or modulate the seed spacing by a `(1−p)`-scaled source-density field — one parameter, same machinery.

**4.3 Assignment + survivor selection in one step — `assignTargets.ts` (deterministic).** Unbalanced min-cost assignment of the `N` source motif centroids → the `M` targets, minimizing total squared displacement; the `M` matched motifs survive (relocate), the `N−M` unmatched are removed. Hungarian on a padded matrix or auction/greedy-nearest; **ties broken by instance index**. Centroids via raster mass-center (reuse `centroid()` from `stratifiedSelect.ts`). *(Minimizing displacement keeps the redistributed print close to the original composition.)*

**4.4 Render — deterministic composite — `densityRedistribute.ts`.**
1. **Erase all `N` originals:** union region (`markInstance` + `dilate(2)` from `densityThin.ts`) ∩ `fabric.raster`; sample base cloth (`baseClothAnchor` from `densityThin.ts`; null → no-op refund, the F2 guard); `infillBaseCloth({ image, region, baseClothLab, featherPx:1, flatten:true })` — the exact v1 erase (`ops/infill.ts`).
2. **Composite `M` survivors at targets:** `sharp(...).extract(instance bbox)` the source crop, mask to the instance raster (non-motif → transparent), `.composite([{ input, left: round(tx−cropW/2), top: round(ty−cropH/2) }])` — **no resize** (scale preserved), **no rotate** (D3). Feather the crop edge via its instance-mask alpha (reuse the blur→per-pixel-alpha blend idiom from `scaleRepeat.ts`); optional local-luminance match to reduce seams.
- Return `{ data, width, height, kept, removed: N−kept, targets, assignments }` (`RedistributeResult extends InfillResult`).

**4.5 Refund contract.** Return `removed`/`kept` truthfully; the live wrapper (§7) returns `null → FAIL+REFUND` on `removed===0` — mirroring `generateDensityImage`. Never bill a no-op.

**Determinism:** steps 4.1–4.4 are byte-deterministic under composite render → the eval's `Buffer.compare(r1,r2)===0` check applies unchanged. (Under the deferred generative renderer, determinism is asserted on `targets`/`assignments` JSON only.)

## 5. Files
**New** (`server/_core/studio/`): `ops/densityRedistribute.ts`, `ops/blueNoiseLayout.ts`, `ops/assignTargets.ts`, `eval/redistributeMetrics.ts`, `eval/redistributeEval.ts` (mirrors `eval/densityEval.ts`).
**New tests (flat in `server/`):** `densityRedistribute.test.ts`, `blueNoiseLayout.test.ts`, `assignTargets.test.ts`, `redistributeMetrics.test.ts`.
**Reuse (no behavior change):** `ops/infill.ts`(`infillBaseCloth`,`InfillResult`) · `ops/color.ts`(`rgb255ToLab`,`labToRgb255`,`deltaE2000`,`Lab`) · `ops/kmeans.ts`(`kmeans`,`Vec3`) · `ops/stratifiedSelect.ts`(`centroid`/edge-margin) · `ops/densityThin.ts`(`markInstance`,`dilate`,`baseClothAnchor`) · `ops/scaleRepeat.ts`(`sharp` extract/composite/feather idiom) · `image/decodeUpright.ts` · `masking/types`(`MaskImageInput`,`FabricMask`,`InstanceMask`,`RasterMask`,`BBoxNormalized`,`Sam2AuditContext`) · `masking/sam2Mask`(`rasterBBox`) · `eval/evalMaskIO.ts`(`loadFabricMask`,`loadInstanceLabelMap`,`saveSideBySide`) · `eval/scaleMetrics.ts`(lift `fabricPalette`,`paletteDeltaE`).
**Touch (additive):** `server/_core/env.ts` (+flag) · `eval/densityMetrics.ts` (`export computeNNI`) · `server/aiEngine.ts` (+`generateDensityRedistributeImage`, do NOT modify `generateDensityImage`).
**Do not touch:** `densityThin.ts` behavior, money-path files, routers.

## 6. Validation (the v1 metric does NOT transfer — rebuild from final positions)
`computeDensityMetrics` keys "removed" off source-pixel labels; when survivors relocate, every source site becomes ground → it reports ~100% removed, zero survivors. `redistributeMetrics.ts` measures **final** positions, following the existing metric conventions (pure fns over raw RGBA + truth; op-correctness vs mask-signal split; thresholds with defaults; `seed` default 1). `verdict.pass` requires all:
- **countError ≤ 0.10** — `Mhat` = targets whose OUT window (disk radius `≈√(meanSrcArea/π)`) reads as motif (`ΔE2000(out, ground) > tau`, `tau=5`); `countError = |(N−Mhat)/N − p|`. *(Presence-based — a blank/erased output can't pass.)*
- **placementEvenness — NNI ≥ 1.0** on the **final** centroids, via `computeNNI` (export it). **Caveat:** the `4·√A` perimeter in the Donnelly correction assumes a roughly rectangular window; for irregular fabric silhouettes use a guard/cdf correction or record the approximation.
- **motifFidelity (palette) ≤ 5** — `paletteDeltaE(fabricPalette(source), fabricPalette(out))` (reuse from `scaleMetrics.ts`; "same inks, moved"). No SSIM dependency.
- **motifFidelity (per-motif) ≤ 3** — mean `ΔE2000` between each survivor's source crop and its OUT target region (≈0 for composite render; guards a future generative path).
- **scaleFidelity ≤ 0.05** — per matched motif `|√(areaOut/areaIn) − 1|`.
- **ghosting (infillCleanliness ≤ 2.5)** — `meanGradient` ratio (reuse) over **all `N`** vacated source footprints vs bare-ground baseline.
- **no-op refund guard** — `removed===0 ⇒` refund.
`bgDeltaE` reported but **excluded from pass**, as v1/recolor/scale do.

**Harness `redistributeEval.ts`** mirrors `densityEval.ts`: manifest (`imageUrl,percent,maskUrl,labelUrl`) → `loadFabricMask`/`loadInstanceLabelMap` → op (run twice, `Buffer.compare`) → `computeRedistributeMetrics` → verdict → `saveSideBySide`. **Tests** reuse the `densityThin.test.ts` fixture idiom; assert `removed===round(p·N)`, `kept===N−removed`, determinism, final NNI ≥ 1.0, palette ≤ 5, ghosting ≤ 2.5, and the no-op cases. **Do not** assert survivor byte-identity.

## 7. Live entrypoint (dark; Frank wires + flips)
Add to `aiEngine.ts`, parallel to `generateDensityImage`, **without modifying it**:
```ts
/** Density v2 (dark). SAM2 fabric+instances -> densityRedistribute -> PNG. Same
 *  single-getSegmentation + null-on-degrade/no-op -> FAIL+REFUND contract as
 *  generateDensityImage. Deterministic (composite). No model call. */
export async function generateDensityRedistributeImage(
  originalImageUrl: string, percent: number, audit?: Sam2AuditContext
): Promise<{ png: Buffer; removed: number } | null>
```
**Router wiring is deferred to Frank — not in the implementation PR.** When wired, `studio.generate` will select it only when `ENV.studioDensityRedistribute` is on; until then `studio.generate` stays unchanged and the op is unreachable.

## 8. Open questions for Frank / Architect
- Ratify D1–D4 (esp. D1 deterministic-composite-first; D3 orientation).
- Layout method: early-stopped Lloyd (default) vs sample-elimination vs CCVT — quality vs implementation cost.
- Composite seam-realism bar on real garments (the documented reason a generative upgrade might later be wanted — which reopens the privacy gate + billing guarantee).
- Retire `densityThin` v1 or keep as a fallback?

## 9. PR-body checklist
- [ ] `feat/density-redistribute`; **draft**; authored under my own identity (not Frank).
- [ ] `STUDIO_DENSITY_REDISTRIBUTE` default **off**; op not router-wired.
- [ ] `densityThin`/`generateDensityImage`/money-path untouched; only additive change to existing code is `export computeNNI`.
- [ ] `tsc --noEmit` clean; 4 test files pass; eval `verdict.pass`.
- [ ] Decisions awaiting Frank/Architect: D1–D4, layout method, composite-realism bar, v1 retire/keep.
- [ ] **Not merged; flag not flipped.**

## 10. Provenance (verified at `55577c7`; re-verify against `main` before coding)
`ops/densityThin.ts` `fed620b` · `ops/infill.ts` `9c7bdfd` · `ops/stratifiedSelect.ts` `88e757d` · `ops/scaleRepeat.ts` `9b50771` · `eval/densityMetrics.ts` `08ec350` · `eval/scaleMetrics.ts` `f632eb8` · `eval/densityEval.ts` `443ad7d` · `eval/evalMaskIO.ts` `74f0d74` · `masking/types.ts` `89e4452` · `densityThin.test.ts` `5f3f8d2` · `densityLive.test.ts` `23827b9` · `aiEngine.ts` `d61931b` · `_core/env.ts` `2ccc05b`.

## 11. Design rationale & references
- **Even target = blue noise.** Ulichney (1987): an even, isotropic, unstructured point distribution that captures local density through local point density. The design goal of an "all-over" textile print — even balance of motif and negative space, consistent motif scale, no crowding and no large unintentional gaps — is the design-domain statement of the same property (surface-pattern-design literature).
- **Generating the even layout.** Poisson-disk sampling (Cook 1986; Bridson 2007, O(n)) and Lloyd relaxation toward a centroidal Voronoi tessellation both produce blue noise. **Critical guard:** Lloyd over-regularizes into a lattice and loses blue-noise quality if run to convergence — terminate early (basis for §4.2's fixed small iteration count). Capacity-constrained Voronoi tessellation (Balzer, Schlömer & Deussen 2009) and Yuksel weighted sample elimination (CGF 34(2):25–32, 2015; params α=8, β=0.65, γ=1.5) give exact point counts that raw Poisson-disk cannot.
- **Spacing/radius.** Densest hexagonal packing of `M` points in area `A` gives `r_max = √(2A/(√3·M)) ≈ 1.075·√(A/M)`; scale by a relative radius `ε ∈ [0,1]` (Gamito & Maddock 2009). `ε ≈ 0.75` keeps it even-but-organic.
- **Evenness metric.** Clark & Evans (1954) nearest-neighbor index `R` = observed/expected mean NN distance (R>1 dispersed, R<1 clustered), with the Donnelly (1978) edge correction (the `spatstat` default for rectangular windows; uncorrected `R` is positively biased). Matches the repo's `computeNNI`; the perimeter approximation is the noted caveat.
- **Graded variant.** Density-field point placement via CVT with a density function τ (Secord 2002, weighted Voronoi stippling; Deussen et al. 2000) or variable-radius Poisson-disk (greyscale-modulated minimum distance).

### References — exact locators (verified 2026-06-21)
*(Bibliographic-precision pass: every attribution above re-validated to exact author / venue / volume / pages. The prose rationale is unchanged; this just makes each cite exact. Two fixes folded in: Gamito & Maddock year 2008 → **2009** (the published ACM TOG paper; a 2008 Univ. of Sheffield tech-report version also exists); Donnelly's host volume is *Simulation **Studies** in Archaeology*, not "Methods". Lloyd's method, named in §4.2, now carries its canonical citation.)*

1. R. Ulichney. *Digital Halftoning.* MIT Press, 1987. — blue noise: even, isotropic, unstructured point distribution capturing local density via local point density.
2. R. L. Cook. *Stochastic Sampling in Computer Graphics.* ACM TOG **5(1):51–72**, 1986. — Poisson-disk / blue-noise sampling.
3. R. Bridson. *Fast Poisson Disk Sampling in Arbitrary Dimensions.* ACM SIGGRAPH 2007 Sketches, **Art. 22**, 2007 (DOI 10.1145/1278780.1278807). — O(n) Poisson-disk.
4. S. P. Lloyd. *Least Squares Quantization in PCM.* IEEE Trans. Information Theory **28(2):129–137**, 1982 (DOI 10.1109/TIT.1982.1056489). — Lloyd relaxation toward a centroidal Voronoi tessellation (basis for §4.2; **stop early — convergence over-regularizes into a lattice**).
5. M. Balzer, T. Schlömer, O. Deussen. *Capacity-Constrained Point Distributions: A Variant of Lloyd's Method.* ACM TOG (SIGGRAPH) **28(3), Art. 86 (86:1–86:8)**, 2009. — exact-count blue noise (CCVT).
6. C. Yuksel. *Sample Elimination for Generating Poisson Disk Sample Sets.* Computer Graphics Forum (Eurographics 2015) **34(2):25–32**, 2015 (DOI 10.1111/cgf.12538). — weighted sample elimination to an exact point count (defaults α=8, β=0.65, γ=1.5).
7. M. N. Gamito, S. C. Maddock. *Accurate Multidimensional Poisson-Disk Sampling.* ACM TOG **29(1), Art. 8 (8:1–8:19)**, 2009 (DOI 10.1145/1640443.1640451). — relative-radius (ε) spacing relation.
8. P. J. Clark, F. C. Evans. *Distance to Nearest Neighbor as a Measure of Spatial Relationships in Populations.* *Ecology* **35(4):445–453**, 1954 (DOI 10.2307/1931034). — nearest-neighbor index R (observed/expected mean NN distance; R>1 dispersed, R<1 clustered). Matches the repo's `computeNNI`.
9. K. Donnelly. *Simulations to determine the variance and edge-effect of total nearest neighbour distance.* In I. Hodder (ed.), *Simulation Studies in Archaeology*, Cambridge University Press, 1978, **pp. 91–95**. — edge correction for R (the `spatstat` default for rectangular windows; uncorrected R is positively biased). The non-rectangular-window approximation is the §6 caveat.
10. A. Secord. *Weighted Voronoi Stippling.* Proc. 2nd Int. Symp. on Non-Photorealistic Animation and Rendering (**NPAR '02**), ACM, **pp. 37–43**, 2002 (DOI 10.1145/508530.508537). — density-weighted CVT point placement (graded-variant basis, D2).
11. O. Deussen, S. Hiller, C. van Overveld, T. Strothotte. *Floating Points: A Method for Computing Stipple Drawings.* Computer Graphics Forum (Eurographics 2000) **19(3):41–50**, 2000 (DOI 10.1111/1467-8659.00396). — density-driven stipple placement (graded-variant basis, D2).

## 12. Out of scope
Increasing density; generative render (deferred); router wiring; flipping `STUDIO_DENSITY_REDISTRIBUTE`.
