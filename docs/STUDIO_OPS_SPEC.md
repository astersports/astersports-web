# Print Studio Operations Spec: Scale and Density

**Status:** CANONICAL. Single source of truth for what Scale and Density mean in Print Studio and the rules the build follows.
**Date:** 2026-06-20. **Lane:** Architect.
**Authority:** Grounded in verified code on `main`: `scaleRepeat.ts` (blob `63f51e9a`), `densityThin.ts` (in commit `4fdfd37`), `aiEngine.ts` (blob `78fb678f`), the `generate` route gate in `studio.ts` (blob `5c870730`), reconciled with the locked live-wiring decisions D-A through D-D (`f654ffed`, ruled at `7c36d8f`).
**Supersedes:** `docs/scale-density-build-assessment.md` (stale: its wiring-gap table lists `STUDIO_SCALE_LIVE`, `STUDIO_DENSITY_LIVE`, the helpers, and the router branches as missing; they are built and merged on `main`). Absorbs and replaces the stranded `docs/scale-density-live-wiring-spec.md` (PR #1). When any other doc disagrees with this one, this one wins. Code is the final ground truth: where code and this spec diverge, change one to match the other on purpose, never silently.

---

## 0. The two definitions, one line each

**Scale changes how big the motifs are.** It resizes the entire repeat by one factor. Every motif stays identical to every other motif and to the original artwork. Only the absolute size changes. Scaling down fits more of the repeat in view; scaling up fits less. It is the same print at a different size, never a redraw and never a random reduction.

**Density changes how many motifs there are.** It removes a requested percentage of motif instances counted as whole objects, lets the ground show where they were, and leaves every surviving motif exactly as it was, same size, same position. The motifs do not change; the coverage changes.

The line that separates them: **scale changes size and keeps every motif identical; density changes count and keeps every survivor identical.** Scale = size. Density = count.

Worked examples (the contract, in plain terms):

- **Scale down 30 percent:** the print is redrawn at 70 percent of its size. A 2-inch flower becomes a 1.4-inch flower. Because each repeat is smaller, more flowers now fit on the same garment, and every flower is still the exact same shape and size as every other flower. Nothing is stretched, cropped per motif, or randomly deleted.
- **Density down 30 percent:** you counted 100 blossoms, so 30 are removed and 70 remain. The 70 that remain are untouched, same size, same place, same color. The 30 gaps become plain cloth. The flowers are not shrunk; there are simply fewer of them, spread evenly across the print.

---

## 1. Shared vocabulary (so every lane means the same thing)

- **Motif:** one discrete design element, for example a single blossom. The unit you count for density.
- **Repeat:** the tile that reproduces across the cloth. Common layouts: full-drop (grid aligned), half-drop (alternate columns shifted half a tile, common for florals), brick (alternate rows shifted), mirror or turnover (flipped), tossed or scattered (varied angles and positions to read as non-directional).
- **Ground:** the background cloth between motifs.
- **Coverage (figure-to-ground ratio):** how much of the ground the motifs occupy. High coverage reads packed; low coverage reads open or airy. Very small, densely scattered motifs are called ditsy. Density is the control that moves coverage.
- **Scale of a print:** the physical size of the motifs and the repeat. Large-scale versus small-scale (ditsy) is a scale difference, not a density difference.
- **Allover or yardage print:** a motif or motif set that tiles continuously across the cloth with no visible join. This is what Scale and Density operate on.
- **Placement or engineered print:** a single graphic positioned at one spot (chest graphic, border print, panel print). This is not a repeat and is out of scope for v1 (see section 5).
- **Colorway:** the set of colors in the print. Both ops preserve the colorway.

---

## 2. SCALE

### 2.1 Fashion definition
Scaling a print is uniformly enlarging or reducing the entire repeat, every motif and the spacing between motifs, by one proportional factor. It is a single transform of the repeat unit. Individual motifs are never redrawn, distorted, or resized relative to one another. They stay identical to each other and to the original artwork; only their absolute size changes. After scaling, the design must still tile continuously and read as the same print at a new size. Scaling down means smaller motifs, and because the repeat is smaller more of it appears in the same area, so the eye sees more motifs. Scaling up means larger motifs and fewer in view. The change in how many motifs appear is a consequence of resizing the one repeat, not the addition or removal of motifs.

### 2.2 Invariants
- **Held constant:** motif identity (each motif identical to the others and to the source shape), the relative geometry of the repeat (layout and spacing ratios), the colorway, and everything outside the print (garment silhouette, folds, background).
- **Changed:** the absolute size of the motifs and the repeat.

### 2.3 Algorithm (as built and verified)
Resample the entire fabric region by a single factor `f = (100 + percent) / 100` using a high-quality kernel (lanczos3), so every motif scales identically by construction. On shrink (`f < 1`) the smaller resampled patch is mirror-tiled to refill the fabric region, which yields more, smaller, matching motifs and joins without a visible seam. On enlarge (`f > 1`) the resampled patch is center-cropped back to the region, which yields larger, fewer motifs. The result is composited only inside the fabric raster with a 1-pixel feather, so every pixel outside the print is byte-identical to the original. The op requires a real raster mask (rasterReady from SAM2) and errors when only a bounding box is available, so background is never swept into the scale. The op is deterministic: identical inputs produce byte-identical outputs.

### 2.4 Acceptance (eval thresholds)
- `scaleRatioError <= 0.15`: the measured size change matches the requested factor.
- `paletteDeltaE <= 5`: the colorway is preserved.
- `poseBgDeltaE`: reported but excluded from the pass verdict. A bbox composite sweeps in some background pixels; only a precise raster removes this entirely. It is a mask-quality signal, not an op failure.

### 2.5 Fail and refund
Empty fabric raster causes the helper to throw, and the existing refund path fires. No paid no-op. See the known gap in section 10 (effect-based no-op parity).

---

## 3. DENSITY

### 3.1 Fashion definition
Reducing density is removing a requested percentage of the motif instances and letting the ground show through where they were, without changing the surviving motifs. You count the motifs, remove that percentage by count, and the survivors keep their exact size, orientation, and position. Removed spots become plain ground that matches the surrounding cloth. A designer thins evenly across the repeat so the result stays balanced and intentional rather than patchy. Density moves coverage (the figure-to-ground ratio); it does not touch motif size. The contract: count 100 blossoms, reduce 30 percent, remove 30, keep 70 unchanged.

### 3.2 Invariants
- **Held constant:** every surviving motif is byte-identical (same size, same orientation, same position, same pixels), the colorway, and everything outside the print.
- **Changed:** the count of motifs, and therefore coverage.

### 3.3 Algorithm (as built and verified)
Count every motif instance the segmentation returns (`n`). Remove count `= clamp(round(n * percent / 100), 0, n)`, counted as whole objects, never by area. Choose which to remove with a deterministic stratified subset selection (grid the region into cells, bucket instances by centroid, round-robin across cells) so removals are spread evenly with no randomness. Erase each removed instance by infilling base-cloth color (dominant ground color from k-means, `k = 3`, with luminance flattened so no ghost remains on opaque motifs whose lightness differs from the cloth). Protect survivors with the survivor-clip invariant: the removal region is each selected instance dilated 2 pixels, AND the fabric raster, AND NOT any surviving instance, so dilation can never bleed onto a neighbor. The op is deterministic.

### 3.4 Acceptance (eval thresholds)
- `countError <= 0.10`: the right number of instances was removed.
- `survivorIntegrity <= 2` deltaE: survivors are unchanged.
- `evenness <= 1.5`: removals are spread, not clustered.
- `infillCleanliness <= 2.5`: removed areas read as clean ground.
- `bgDeltaE`: reported but excluded from the pass verdict (same rationale as scale).

### 3.5 Fail and refund
Throw and refund on any of: empty or missing raster, zero instances, no bare ground available to sample, or removed count equals zero. No paid no-op.

---

## 4. Orthogonality: why Scale and Density do not combine yet
Scale and Density are independent axes. Scale changes motif size and keeps motifs identical to one another; the apparent count rises on shrink only as a side effect of fitting a smaller repeat. Density changes motif count and keeps motifs at their original size and position. Because they are independent, v1 runs them one at a time. A job that asks for scale or density together with any other edit is rejected before any credit is touched (decision D-A). Deterministic chaining of the two is a later enhancement, not v1.

---

## 5. Print-type scope and the non-repeat guard
v1 operates only on allover or yardage prints (a motif or motif set that tiles). v1 does not operate on placement or engineered prints (a single positioned graphic, border print, or panel print). Mirror-tiling a single placed graphic when shrinking produces nonsense, and thinning a single graphic by count is meaningless. These must be rejected before any credit is taken by a non-repeat guard: if repeat or period confidence is below threshold, reject with a clear message and charge nothing. This guard is not built yet and is a hard pre-live blocker for Scale (see section 10).

---

## 6. Out of scope for v1 (named so expectations are clear)
- On-body drape and fold displacement warp. v1 treats the print as flat-lay; it does not bend the print around folds or the body.
- Tile-boundary lighting and seam cleanup beyond the 1-pixel feather.
- Generative relight finish. Off by default and never part of the pass verdict.

---

## 7. Live-wiring rules (locked decisions D-A through D-D, built and merged on main)
- **Distinct LIVE flags:** `STUDIO_SCALE_LIVE` and `STUDIO_DENSITY_LIVE`, default off, separate from the eval-only flags `STUDIO_DETERMINISTIC_SCALE` and `STUDIO_DETERMINISTIC_DENSITY`. The eval flags must never gate the money path.
- Both routes engage the deterministic op only when the mask provider is `rasterReady` (SAM2 provisioned).
- **D-A combined controls:** when the live flag is on and the provider is rasterReady, a job that includes scale or density alongside any other edit is rejected with `BAD_REQUEST` before any credit is deducted. Flag off, prod is unchanged.
- **D-B provider not rasterReady:** if a live flag is on but the provider is not rasterReady (misconfig or SAM2 down), fall back to the existing prompt path and WARN with job id and org id. Do not fail the user job, do not be silent.
- **D-C no-op billing guard:** the deterministic helper throws on a degenerate mask so the existing refund path fires. No paid no-op. Density floor (removed equals zero) and scale floor (empty raster) ship now; the absurdly-many-instances ceiling waits for real SAM2 data before the Architect sets the bound.
- **D-D pricing unchanged.** `computeCredits` is not changed by either route; deterministic pricing is revisited once all three ops are live.
- Two deterministic helpers live in `aiEngine.ts`, one per op, each resolves the source, gets the SAM2 mask (and instance masks for density), calls the op, and encodes the op result to PNG. **Confirmed as built:** the density helper is `generateDensityImage` (not `generateThinnedImage` as the earlier draft spec proposed). The name is implementation detail; the contract above is what is normative.

---

## 8. Acceptance summary (one table)

| Op | Metric | Threshold | In pass verdict |
|----|--------|-----------|-----------------|
| Scale | scaleRatioError | <= 0.15 | yes |
| Scale | paletteDeltaE | <= 5 | yes |
| Scale | poseBgDeltaE | (reported) | no |
| Density | countError | <= 0.10 | yes |
| Density | survivorIntegrity | <= 2 dE | yes |
| Density | evenness | <= 1.5 | yes |
| Density | infillCleanliness | <= 2.5 | yes |
| Density | bgDeltaE | (reported) | no |

---

## 9. Fail and refund (no paid no-op), both ops
A job must never be charged for an output that did not change the print. Each op throws on a degenerate or no-effect case and the existing refund path fires. Scale: empty raster today, plus the effect-based parity in section 10. Density: empty or missing raster, zero instances, no ground to sample, or removed equals zero.

---

## 10. Known gaps — CLOSED
1. **Scale non-repeat guard (section 5).** ~~Reject placement and engineered prints before charging, using repeat or period confidence below threshold.~~ **BUILT** (commit `687a7f3e`): `repeatGuard.ts` runs biased-autocorrelation `checkRepeat()` before the scale op; throws `NON_REPEAT_SCALE_ERROR` when `periodConfidence < 0.2`. Studio router catches it, refunds, and surfaces an honest message. 15 tests cover the guard.
2. **Scale effect-based no-op parity.** ~~Density refunds when it removes nothing; Scale only refunds on an empty raster.~~ **BUILT** (commit `687a7f3e`): `scalePrintRepeat` now returns `changed: boolean`; `generateScaledImage` throws `NO_OP_SCALE_ERROR` when `changed === false` (f===1 or degenerate mask). Refund path fires. Tested.

---

## 11. Operational go-live gates (pointer, not part of the semantic contract)
These are separate from the definitions above and tracked in the gate list: SAM2 privacy gate (crop-to-fabric, org id logging, retention, fail-safe, sub-processor disclosure), eval runners that actually execute, real-garment per-route eval, prod env verified dark before any flip, Architect verifies the live-candidate SHA, Frank holds each flag flip one at a time. Scale and Density both require the SAM2 provider live.
