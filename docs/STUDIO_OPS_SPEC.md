# Print Studio Operations Spec: Scale and Density

**Status:** CANONICAL. Single source of truth for what Scale and Density mean in Print Studio and the rules the build follows.
**Version:** 3 (2026-06-20). **Lane:** Architect.
**Control decisions:** The five open control numbers are resolved in section 12, folding in Claude Code's 12-domain industry sweep. Every new control and guard is marked BUILT or PLANNED so the spec never over-claims.
**Verification:** Reconciled against Manus's line-by-line code audit at checkpoint `692dacdc`, then independently re-verified by the Architect at these blobs: `stratifiedSelect.ts` (`88e757d1`), `env.ts` (`c4c03178`), `studio.ts` (`cb4f0aec`), the prior committed spec (`1053497f`), plus earlier reads of `scaleRepeat.ts`, `densityThin.ts`, and `aiEngine.ts`. Three audit discrepancies and four wording imprecisions were confirmed true and corrected. Two internal contradictions left by an earlier partial edit (section 5 said the non-repeat guard was unbuilt while section 10 said it was closed) were also fixed, and the fashion industry-grounding (sections 2.6, 3.6, Appendix A) was restored after it was dropped from the first commit.
**Supersedes:** the first canonical version on main (`1053497f`), `docs/scale-density-build-assessment.md` (stale), and the stranded `docs/scale-density-live-wiring-spec.md` (PR #1). When any other doc disagrees with this one, this one wins. Code is the final ground truth: where code and this spec diverge, change one to match the other on purpose, never silently.

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

> **REDESIGN (draft, pending Architect SHA sign-off — see `docs/scale-redesign-spec.md`).** The lattice-aware repeat-scale section below supersedes the v1 §2.1–§2.7 mechanism that follows it. The v1 text is retained beneath for review diff and is deleted on adoption. No flag flip, no money-path change: `STUDIO_SCALE_LIVE` stays default-off; the detector-calibration gate still governs the flip.

### Scale (vN+1 — lattice-aware repeat-scale)

**Definition.** Scale resizes the entire repeat by one factor `f` — motifs and spacing together — preserving coverage and layout type. Shrink fits more of the repeat in view; enlarge fits less. (`targetFraction = (100+percent)/100`; `percent` clamped `[-50,+100]` at the tRPC boundary → `f ∈ [0.5, 2.0]`.)

**Mechanism (built target).** (1) Recover the 2-D lattice — two generating vectors — from the masked fabric via 2-D autocorrelation-surface peaks, with robust/symmetry variants. (2) Classify layout from the lattice offset: full-drop (offset ≈ 0), half-drop (½H on the horizontal step), brick (½W on the vertical step), mirror (reflection symmetry). (3) Route: true repeat → lattice re-tile; single placed graphic / aperiodic → resize about centroid; border → frieze-axis scale. (4) Lattice path: scale tile + generating vectors by `f` (map `L→Lr`, warp), re-tile on the scaled lattice preserving original phase, seam via min-error-cut quilting / graph-cut / symmetry-guided. (5) Anti-alias on shrink (lanczos3 v1; content-adaptive / perceptual follow-up). (6) Composite with existing 1-σ feather, byte-identical-outside, alpha-preserve.

**Invariants.** Layout type and spacing ratios constant; coverage constant (this is what keeps Scale orthogonal to Density); garment frozen; byte-identical outside mask; deterministic.

**Acceptance.** `scaleRatioError ≤ 0.15` (lattice-vector ratio primary; log-polar phase-correlation cross-check); `paletteDeltaE ≤ 5`; `poseBgDeltaE ≤ 2` excluded; **coverage-delta ≈ 0** (orthogonality). Metric confidence = MIN across axes.

**Guards.** Empty → NO_OP; upscale DPI guard `effectiveDPI = sourceDPI/f`, reject `< 150` if DPI present; shrink min-feature advisory `0.02"` (wire it); non-repeat → router (center-resize), not reject.

**Go-live gate (unchanged).** `repeatDetector.ts` graduates from dormant to the live analyzer and is the hard Scale blocker; its thresholds are **calibrated on a labeled allover/border/placement garment set before the flag flips**. Interim `MIN_REPEAT_CONFIDENCE = 0.2` floor stays live until then. `STUDIO_SCALE_LIVE` default off; SAM2 live + real-garment eval + prod-dark + Architect SHA sign-off; Frank flips one flag at a time.

**Composability.** Scale (size axis) and Density (count axis) are orthogonal and commute; both land at motif size `f·s`, coverage `(1−p)·C`. Canonical chain order scale → density (re-segment instances after Scale). v1 runs standalone (D-A reject retained); chaining is a later flag-flip over shared machinery.

---

> **SUPERSEDED v1 mechanism (retained for review diff; delete on adoption of the redesign above).**

### 2.1 Fashion definition
Scaling a print is uniformly enlarging or reducing the entire repeat, every motif and the spacing between motifs, by one proportional factor. It is a single transform of the repeat unit. Individual motifs are never redrawn, distorted, or resized relative to one another. They stay identical to each other and to the original artwork; only their absolute size changes. After scaling, the design must still tile continuously and read as the same print at a new size. Scaling down means smaller motifs, and because the repeat is smaller more of it appears in the same area, so the eye sees more motifs. Scaling up means larger motifs and fewer in view. The change in how many motifs appear is a consequence of resizing the one repeat, not the addition or removal of motifs.

### 2.2 Invariants
- **Held constant:** motif identity (each motif identical to the others and to the source shape), the relative geometry of the repeat (layout and spacing ratios), the colorway, and everything outside the print (garment silhouette, folds, background).
- **Changed:** the absolute size of the motifs and the repeat.

### 2.3 Algorithm (as built and verified)
Resample the entire fabric region by a single factor `f = (100 + percent) / 100` using a high-quality kernel (lanczos3), so every motif scales identically by construction. On shrink (`f < 1`) the smaller resampled patch is reflect-tiled to refill the fabric region (alternate columns and rows are flipped so tile edges meet without a hard seam), which yields more, smaller, matching motifs. On enlarge (`f > 1`) the resampled patch is center-cropped back to the region, which yields larger, fewer motifs. The result is composited only inside the fabric raster with a 1-sigma Gaussian feather (`sharp.blur(1)`, roughly a 2 to 3 pixel transition), so every pixel outside the print is byte-identical to the original. The op requires a real raster mask (rasterReady from SAM2) and errors when only a bounding box is available, so background is never swept into the scale. The op is deterministic: identical inputs produce byte-identical outputs.

### 2.4 Acceptance (eval thresholds)
- `scaleRatioError <= 0.15`: the measured size change matches the requested factor.
- `paletteDeltaE <= 5`: the colorway is preserved.
- `poseBgDeltaE`: reported but excluded from the pass verdict. A bbox composite sweeps in some background pixels; only a precise raster removes this entirely. It is a mask-quality signal, not an op failure.

### 2.5 Fail and refund
No paid no-op. `scalePrintRepeat` returns a `changed` flag; `generateScaledImage` throws `NO_OP_SCALE_ERROR` on an empty fabric raster and when the scale had no effect (factor 1 or a degenerate mask). The router treats the thrown variation as failed and refunds the full charge.

### 2.6 Industry grounding
Scale, in the trade, is the physical size of the motifs and the repeat. Designers band it roughly as small-scale (about half an inch and under), medium-scale (about half an inch to four inches), and large-scale (above four inches). A very small-scale, scattered, non-directional allover print is a ditsy print. Scaling down toward ditsy and up toward large-scale is the same axis the industry already names. This matches our op with no change. Sources: Appendix A.

### 2.7 Control range and upscale guard (resolved, see section 12)
- **Range:** multiplicative percent of original. 50 to 200 percent. 100 percent is unchanged. Default 100, centered. Steps: 5 percent coarse, 1 percent fine. Maps to the built factor `f = (100 + percent) / 100`. **Status:** the factor is BUILT; the 50 to 200 clamp is PLANNED, add it to the scale control schema the same way density already clamps 0 to 90.
- **Upscale DPI guard (PLANNED, pre-flip):** the 200 percent ceiling is bounded by print quality, not a flat cap. On enlarge (`f > 1`), effective output DPI = source DPI / `f`. Read source DPI from image metadata (`sharp metadata().density`). Enforce effective DPI >= 150: reject pre-deduct with an actionable message when it would fall below. When the source carries no DPI metadata the basis is unknown, so degrade to warn-only rather than block. Upscaling raster art past its resolution softens print, so this guard, not a magic number, is the real limiter.
- **Scale-down min-feature warning (PLANNED, advisory):** when shrinking would push the finest features below a printable floor, show a non-blocking advisory. Never blocks, never affects billing.

---

## 3. DENSITY

### 3.1 Fashion definition
Reducing density is removing a requested percentage of the motif instances and letting the ground show through where they were, without changing the surviving motifs. You count the motifs, remove that percentage by count, and the survivors keep their exact size, orientation, and position. Removed spots become plain ground that matches the surrounding cloth. A designer thins evenly across the repeat so the result stays balanced and intentional rather than patchy. Density moves coverage (the figure-to-ground ratio); it does not touch motif size. The contract: count 100 blossoms, reduce 30 percent, remove 30, keep 70 unchanged.

### 3.2 Invariants
- **Held constant:** every surviving motif is byte-identical (same size, same orientation, same position, same pixels), the colorway, and everything outside the print.
- **Changed:** the count of motifs, and therefore coverage.

### 3.3 Algorithm (as built and verified)
Count every motif instance the segmentation returns (`n`). Remove count `= clamp(round(n * percent / 100), 0, n)`, counted as whole objects, never by area. Choose which to remove with a deterministic stratified subset selection (`stratifiedSelect.ts`): seed from the instance nearest the fabric center, then greedily pick the instance whose weighted minimum distance to the already-chosen removals is largest (farthest-point sampling), with an interiority weight that runs from about 0.3 at the fabric edge to 1.0 in the interior so edge instances are penalized. Edge motifs are therefore preferentially kept as survivors, since they are harder to infill cleanly at the boundary. Ties break by index. There is no randomness: the selection is byte-stable, and removals are spread evenly across the interior. Erase each removed instance by infilling base-cloth color (dominant ground color from k-means, `k = 3`, with luminance flattened so no ghost remains on opaque motifs whose lightness differs from the cloth). Protect survivors with the survivor-clip invariant: the removal region is each selected instance dilated 2 pixels, AND the fabric raster, AND NOT any surviving instance, so dilation can never bleed onto a neighbor. The op is deterministic.

### 3.4 Acceptance (eval thresholds)
- `countError <= 0.10`: the right number of instances was removed.
- `survivorIntegrity <= 2` deltaE: survivors are unchanged.
- `evenness <= 1.5`: removals are spread, not clustered.
- `nniDispersion >= 1.0` (PLANNED): Nearest-Neighbor Index over survivor centroids within the fabric area, with boundary correction. R = 1 is random, R > 1 is dispersed, R < 1 is clustered. The farthest-point selection is dispersed by construction, so this clears with margin and only trips on the real failure mode (tracking, holes, clumps). Backs evenness for the highest-risk defect. See section 12.
- `infillCleanliness <= 2.5`: removed areas read as clean ground.
- `bgDeltaE`: reported but excluded from the pass verdict (same rationale as scale).

### 3.5 Fail and refund
No paid no-op. The op returns a no-op signal (`removed: 0`) on any of: empty or missing raster, zero instances, no bare ground to sample, or removed count equals zero. `generateDensityImage` then returns `null`, the router rejects that variation, and the full charge is refunded. Density never falls back to the prompt path, because the generative path cannot do count-based removal and would silently ignore the ask.

### 3.6 Industry grounding and terminology
The textile term for the axis our Density control moves is coverage: the area of a repeat occupied by motifs (for example, 50 percent coverage is an even split of motif and ground). Layouts are described as packed or tight versus open or spaced, with mixed called open-and-closed. Reducing our Density takes a print from packed toward open by removing motif instances and revealing ground. That is exactly a coverage reduction.

Two precision points so the build is unambiguous:
- Terminology overload. In textiles, density also names two unrelated things: fabric density or weight (ounces per square yard, stitches per square inch) and high-density printing (a raised 3D puff technique). Our Density control means motif coverage only, never fabric weight and never a puff effect. Keep the user-facing label Density; the meaning is anchored to coverage here.
- Count versus area. We reduce coverage by removing a percentage of motif instances by count, not by erasing a percentage of covered area. When motifs are uniform (for example 100 same-size blossoms) the two are equal: remove 30 percent of instances and coverage drops about 30 percent. When motif sizes vary, removing 30 percent of instances will not reduce covered area by exactly 30 percent. We define and measure Density by count (countError), which matches the contract: count 100 blossoms, remove 30. Sources: Appendix A.

### 3.7 Control range (resolved, see section 12)
**Range:** reduce by 0 to 90 percent. Default 0. **Status: BUILT** (the router clamps density percent to 0 to 90). Never 100 percent: removing every motif stops being the same print. The ceiling for absurdly many instances waits for real SAM2 data (D-C).

---

## 4. Orthogonality: why Scale and Density do not combine yet
Scale and Density are independent axes. Scale changes motif size and keeps motifs identical to one another; the apparent count rises on shrink only as a side effect of fitting a smaller repeat. Density changes motif count and keeps motifs at their original size and position. Because they are independent, v1 runs them one at a time. A job that asks for scale or density together with any other edit is rejected before any credit is touched (decision D-A; the rejection throws above `deductCredits`, so it is genuinely pre-deduct). Deterministic chaining of the two is a later enhancement, not v1.

---

## 5. Print-type scope and the non-repeat guard
v1 operates only on allover or yardage prints (a motif or motif set that tiles). v1 does not operate on placement or engineered prints (a single positioned graphic, border print, or panel print). Mirror-tiling a single placed graphic when shrinking produces nonsense, and thinning a single graphic by count is meaningless.

The non-repeat guard is built (`repeatGuard.ts`, `checkRepeat`, commit `687a7f3e`, 15 tests). It runs a biased-autocorrelation repeat-confidence check inside `generateScaledImage`. When `periodConfidence < 0.2` it throws `NON_REPEAT_SCALE_ERROR`; all variations fail, the router refunds the full charge, and the user sees an honest message: scale supports repeating prints, this image reads as a single placed graphic, credits refunded.

Mechanism note (verified in `studio.ts`, blob `cb4f0aec`): the guard runs after `deductCredits`, so the flow is deduct then refund-on-failure, not true pre-deduct rejection. The user is fully refunded and keeps their credits, so the economic outcome is correct, but the ledger records a debit and a matching refund rather than no entry. Moving the confidence check ahead of `deductCredits` (true pre-deduct: no ledger churn, and no exposure if a refund write ever fails, which is the open H7 idempotency concern) is the preferred end state and a tracked follow-up. The `TODO` in `studio.ts` that still calls this guard "deferred while the route is dark" is stale and should be removed, since the guard is built and active.

**Detector, current and target (resolved, see section 12).** Current floor, BUILT: `checkRepeat` accepts as a repeat when `periodConfidence >= 0.2` (single biased-autocorrelation pass). Go-live target, PLANNED and a hard Scale blocker: FFT-propose then autocorrelation-validate, classifying as allover only when peak-ratio >= 0.30 AND periodicity-energy >= 0.50 AND there are at least two even peaks on both axes AND the tile repeats at least 2.5 times. Periodicity on one axis only is a border print and is rejected. These numbers are calibration starting points, not frozen constants: the detector must be calibrated on a labeled garment set (allover versus placement and border) and meet its precision and recall bar before the Scale flag flips.

---

## 6. Out of scope for v1 (named so expectations are clear)
- On-body drape and fold displacement warp. v1 treats the print as flat-lay; it does not bend the print around folds or the body.
- Tile-boundary lighting and seam cleanup beyond the 1-sigma Gaussian feather.
- Generative relight finish. Off by default and never part of the pass verdict.

---

## 7. Live-wiring rules (locked decisions D-A through D-D, built and merged on main)
- **Distinct LIVE flags:** `STUDIO_SCALE_LIVE` and `STUDIO_DENSITY_LIVE`, default off. There are no separate eval flags: the former `STUDIO_DETERMINISTIC_*` toggles were removed (Decision 5, see `env.ts`); the scale, density, and recolor eval runners invoke the ops directly and are never flag-gated. The LIVE flags are the only studio op flags, and they gate the money path only.
- Both routes engage the deterministic op only when the mask provider is `rasterReady` (SAM2 provisioned).
- **D-A combined controls:** when the live flag is on and the provider is rasterReady, a job that includes scale or density alongside any other edit is rejected with `BAD_REQUEST` before any credit is deducted (the throws sit above `deductCredits`). Flag off, prod is unchanged.
- **D-B provider not rasterReady:** if a live flag is on but the provider is not rasterReady (misconfig or SAM2 down), scale falls back to the existing prompt path and WARNs with job id and org id; density does not prompt-fall, it fails and refunds (the generative path cannot do count-based removal). Do not fail a scale job silently.
- **D-C no-op billing guard:** the deterministic helper signals a no-op (scale throws `NO_OP_SCALE_ERROR`; density returns `null` via `removed: 0`) so the existing refund path fires. No paid no-op. Density floor (removed equals zero) and scale floor (empty raster or no-effect) ship now; the absurdly-many-instances ceiling waits for real SAM2 data before the Architect sets the bound.
- **D-D pricing unchanged.** `computeCredits` is not changed by either route; deterministic pricing is revisited once all three ops are live.
- Two deterministic helpers live in `aiEngine.ts`, one per op, each resolves the source, gets the SAM2 mask (and instance masks for density), calls the op, and encodes the op result to PNG. **Confirmed as built (verified in `studio.ts` imports):** the density helper is `generateDensityImage` and the scale helper is `generateScaledImage`. The name is implementation detail; the contract above is normative.

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
A job is never charged for an output that did not change the print. Scale: `generateScaledImage` throws `NO_OP_SCALE_ERROR` on an empty raster or a no-effect scale (factor 1 or degenerate mask). Density: the op returns `removed: 0`, `generateDensityImage` returns `null`, and the router rejects the variation. Both paths end in a full refund through the existing all-failed refund branch.

---

## 10. Gap closure status
Both gaps from version 1 are built and tested.
1. **Scale non-repeat guard.** BUILT (commit `687a7f3e`): `repeatGuard.ts` runs `checkRepeat` (biased autocorrelation) inside `generateScaledImage`; throws `NON_REPEAT_SCALE_ERROR` when `periodConfidence < 0.2`; the router refunds and shows an honest message. 15 tests. Remaining refinement (non-blocking): the guard runs post-deduct (deduct then refund), not true pre-deduct. Move the confidence check ahead of `deductCredits` so a non-repeat charges nothing in the first place, and remove the stale `studio.ts` TODO. See section 5.
2. **Scale effect-based no-op parity.** BUILT (commit `687a7f3e`): `scalePrintRepeat` returns `changed`; `generateScaledImage` throws `NO_OP_SCALE_ERROR` when `changed === false` (factor 1 or degenerate mask); the refund path fires. Tested.

---

## 11. Operational go-live gates (pointer, not part of the semantic contract)
These are separate from the definitions above and tracked in the gate list: SAM2 privacy gate (crop-to-fabric, org id logging, retention, fail-safe, sub-processor disclosure), eval runners that actually execute, real-garment per-route eval, prod env verified dark before any flip, Architect verifies the live-candidate SHA, Frank holds each flag flip one at a time. Scale and Density both require the SAM2 provider live.

---

## 12. Control decisions (resolved 2026-06-20, closes the original open numbers)
Resolved by the Architect on the back of Claude Code's 12-domain industry sweep. Frank holds final product authority; any single ruling is reversible on his word. Each carries a build status so the spec never over-claims.

1. **Scale ceiling and limiter.** Ruling: UI ceiling 200 percent; the upscale DPI guard is the real limiter, not a flat cap (chosen over a flat 150 percent cap). A flat cap penalizes high-resolution sources that upscale cleanly and waves through low-resolution sources that should not. Status: factor BUILT; 50 to 200 clamp PLANNED; DPI guard PLANNED (section 2.7).
2. **Upscale DPI guard: enforce or warn.** Ruling: enforce, pre-deduct, when source DPI metadata is present (effective DPI = source DPI / f, floor 150). Warn-only when metadata is absent, since the basis is then unknown. Enforce pairs with decision 1: a limiter that only warns does not limit. Pre-deduct keeps it off the refund path. Status: PLANNED (section 2.7).
3. **Non-repeat detector.** Ruling: approved to build and calibrate the FFT-propose plus autocorrelation-validate detector; it stays a hard Scale blocker. The current `periodConfidence >= 0.2` guard is the interim floor. The proposed gate numbers are calibration targets to tune on a labeled garment set, not theory to freeze. The Scale flip waits for the calibration report. Status: floor BUILT, target PLANNED (section 5).
4. **Density evenness.** Ruling: adopt Nearest-Neighbor Index R >= 1.0 as a second gate alongside `evenness <= 1.5`, computed over survivor centroids within the fabric area with boundary correction. It measures the number-one real-world failure (tracking, holes, clumps) directly, and the farthest-point op clears it by construction. Confirm the margin on the real-garment eval before it becomes a hard pass criterion. Status: PLANNED (section 3.4).
5. **Scale-down min-feature warning.** Ruling: advisory, non-blocking, no billing effect. Scaling down is a legitimate creative choice and the too-small threshold is print-process dependent, so guide rather than block. Status: PLANNED (section 2.7).

Disambiguation carried into code and UI: our Density is motif coverage. It is not ink coverage, not optical density, and not LPI. See section 3.6. Eval thresholds reconfirmed against CIEDE2000 (just-noticeable difference about 1.0): `survivorIntegrity <= 2` reads as perceptible only on close inspection, `paletteDeltaE <= 5` as the same color slightly shifted. Keep them, keep CIEDE2000.

---

## Appendix A: Industry validation (wide fashion-source check, 2026-06-20)
The definitions were checked against a wide sweep of surface-pattern and textile-design sources. Findings: Scale matches the industry use of scale as motif and repeat size, no change needed. Density matches the industry coverage axis (packed versus open or spaced); the only refinement was to anchor our Density label to coverage and flag the density terminology overload (fabric weight, high-density puff printing) plus the count-versus-area distinction. Supporting vocabulary (motif, repeat, full-drop or half-drop or brick, ground, allover or yardage, engineered or placement, tossed or scattered or multi-directional, colorway, ditsy) all matched.

Representative sources:
- Coverage as the area of a repeat occupied by motifs, and packed or tight versus open or spaced layouts: textileengineering.net, Different Types and Styles of Textile Print Design.
- Scale size bands (small, medium, large) and packed versus spaced: fashionistasketch.com, Fashion Fabric Design.
- Repeat as a tile that multiplies, full-drop repeat, scale of the repeat: designer-daily.com, The Grammar of Repeat; sewguide.com, 25 Types of Pattern Repeats.
- Repeat measured in inches and read as the print scale: onlinefabricstore.com, Fabric Patterns: Repeat and Scale.
- Small-scale allover floral as a small repeat: Cornell (char.txa.cornell.edu), Textiles handbook excerpt.
- Engineered or placement print versus allover repeat: patternanddesign.com, Surface Pattern Design Reference Guide.
- Ditsy as a tiny-scale, random, scattered, non-directional allover print: Vintage Fashion Guild; Rag and Magpie; Green Nettle Textiles; Faz Fashion; William Morris Wallpaper.

---

## Appendix B: Change log from version 1 (`1053497f`)
Corrections applied after Manus's code audit at `692dacdc`, each re-verified by the Architect:
- 3.3: stratified selection described accurately as farthest-point sampling with interiority weighting (was: grid cells, bucket by centroid, round-robin). Verified `stratifiedSelect.ts` `88e757d1`.
- 5, 10: non-repeat guard described as built and as deduct-then-refund, not pre-deduct; pre-deduct move named as a follow-up; stale `studio.ts` TODO flagged for removal. Verified `studio.ts` `cb4f0aec`.
- 7: removed the reference to `STUDIO_DETERMINISTIC_*` eval flags, which no longer exist. Verified `env.ts` `c4c03178`.
- 2.3, 6: "1-pixel feather" corrected to a 1-sigma Gaussian feather (`sharp.blur(1)`); "mirror-tiled" clarified as reflect-tiling.
- 2.5, 3.5, 9: fail-and-refund mechanism made exact (scale throws `NO_OP_SCALE_ERROR`; density returns `null` via `removed: 0` and the router rejects).
- Fixed the section 5 vs section 10 contradiction (section 5 had said the guard was unbuilt).
- Restored the fashion industry-grounding (2.6, 3.6, Appendix A) dropped from the first commit.

Version 3 (control decisions folded in):
- Added section 12 resolving the five open control numbers, each with a build status.
- Added 2.7 (scale range 50 to 200, upscale DPI guard, scale-down min-feature advisory), 3.7 (density range 0 to 90), and the planned NNI dispersion gate in 3.4.
- Expanded section 5 with the non-repeat detector target (FFT plus autocorrelation, calibrate before flip) above the built 0.2 floor.
- Source: Claude Code 12-domain industry sweep; eval thresholds reconfirmed against CIEDE2000.
