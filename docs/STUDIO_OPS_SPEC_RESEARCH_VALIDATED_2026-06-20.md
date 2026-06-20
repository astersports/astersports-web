# Print Studio Operations Spec — Scale & Density (Research-Validated Canonical)

**Status:** CANONICAL. Research-validated successor to the Architect's `STUDIO_OPS_SPEC.md` (2026-06-20). Confirms that doc's semantic contract against the textile/print industry and **pins every numeric parameter it left open** (scale range/default/step, density range/default/step, the non-repeat-guard confidence formula, the production resolution limits, the eval thresholds' color-science backing, and an even-distribution metric).
**Date:** 2026-06-20. **Lane:** Architect.
**Method:** 12 parallel web-research agents across (1) textile/surface-pattern terminology, (2) professional textile CAD, (3) Adobe/consumer design tools, (4) print production, (5) print-on-demand platforms, (6) wallpaper/home decor, (7) coverage & color science, (8) repeat/periodicity detection, (9) fashion scale & motif sizing, (10) AI textile competitors, (11) density-reduction practice, (12) percentage-control UX. Sources in §12.
**Relationship to v1:** v1 stays the code-grounded contract; this doc is the industry-grounded one. Where they agree (they do, on the semantic contract), that's a green light. Where this doc adds a number v1 left open, **that number is the decision** unless the Architect amends. Reconcile into a single `STUDIO_OPS_SPEC.md` once Frank signs off the open decisions in §10.

---

## 0. One-paragraph verdict from the research

The industry **confirms the core contract**: *scale changes motif size and keeps every motif identical; density changes motif count/coverage and keeps every survivor identical.* Surface-design educators treat scale and density as **independent levers** ("vary small/medium/large scales **and** dense/open coverage"). The one universal caveat — found in every tool from Spoonflower to NedGraphics — is that **rescaling the tile conflates the two axes** (a smaller tile = more, smaller motifs per yard). That is exactly why our two ops must stay separate: SCALE resamples the repeat; DENSITY must change count **without** resizing motifs. A second strong finding: **a true numeric DENSITY/coverage control does not exist anywhere in the market** (CAD, Adobe, POD, and AI tools all leave density implicit or prompt-based). Our deterministic count-based density op is a genuine product differentiator — and a net-new primitive, so its semantics are ours to define rather than mirror.

---

## 1. The two definitions (validated, one line each)

- **Scale changes how big the motifs are.** One proportional factor resizes the entire repeat; every motif stays identical to every other and to the source; only absolute size changes. *(Confirmed: "uniformly enlarging/reducing the entire repeat by one proportional factor"; motifs never redrawn or distorted.)*
- **Density changes how many motifs there are.** A requested percentage of motif **instances** is removed by count, the ground shows where they were, and every survivor is byte-identical. *(Confirmed: designers "open up / thin out" a print by removing motifs and exposing ground, never by shrinking motifs.)*

`Scale = size. Density = count.` This separation is standard in the literature.

---

## 2. Shared vocabulary — incl. the critical "density" disambiguation

Validated terms: **motif, repeat, ground, coverage (figure-to-ground ratio), scale, ditsy, allover/yardage, placement/engineered, colorway** — all as v1 defines them.

**Repeat layouts** (validated): full-drop/block, **half-drop (alternate columns shifted exactly 50% of tile height — the floral default)**, brick/half-brick, mirror/turnover, tossed/scattered.

**"Density" is overloaded across print — we reserve ONE meaning.** The research surfaced four distinct senses; the spec uses only (a) and renames the rest wherever they appear:
- **(a) Motif density** — count/coverage of motif instances per area. **← our only use of the word "density."**
- **(b) Ink coverage %** — fraction of substrate inked (CMYK Total Area Coverage, practical cap 240–320%). Call this **"ink coverage."**
- **(c) Optical/tonal density (D)** — `D = log₁₀(1/reflectance)`. Call this **"optical density (D)."**
- **(d) Halftone dot density / LPI** — screen frequency. Call this **"LPI."**

Any code, UI string, or doc that means (b)/(c)/(d) must use those names, never bare "density."

---

## 3. SCALE — full specification

### 3.1 Definition & invariants (validated, unchanged from v1)
Uniform resample of the entire fabric region by one factor. **Held constant:** motif identity, repeat geometry/spacing ratios, colorway, everything outside the print. **Changed:** absolute motif/repeat size.

### 3.2 Algorithm (as built and verified — `scaleRepeat.ts`)
Resample the fabric region by `f` with lanczos3 so every motif scales identically. Shrink (`f<1`): mirror-tile the smaller patch to refill the region (more, smaller, matching motifs, seamless). Enlarge (`f>1`): center-crop the resampled patch back to the region (larger, fewer motifs). Composite only inside the fabric raster with a 1px feather; pixels outside the print stay byte-identical. Requires a real raster mask (SAM2 rasterReady); errors on bbox-only. Deterministic.

### 3.3 Parameter — PINNED (was open in v1)
- **User-facing representation:** **multiplicative % of original, 100% = unchanged.** This is the universal mental model (Photoshop/Illustrator pattern scale, Spoonflower, every zoom control). Do **not** use a signed ±delta in the UI (forces mental math; `−50%` then `+50%` doesn't round-trip).
- **Internal mapping to the built op:** `f = uiScalePercent / 100` (equivalently the built `f = (100 + percent)/100` with `percent = uiScalePercent − 100`). Keep the op's signature; map at the router/UI boundary.
- **Range:** **50%–200%**, default **100%**, neutral centered on the track. (50–200% is the established zoom-slider span and the textile "half-scale / double-scale coordinate" idiom.)
- **Step:** 5% on drag, 1% via keyboard, with a paired numeric field.
- **Upscale resolution guard (NEW — production):** enlarging a raster past its native resolution degrades print quality. Allow `>100%` **only if effective output resolution stays ≥ 150 DPI at the print's physical size** (300 DPI is the textile ideal). If a requested upscale would drop effective DPI below 150, clamp to the max scale that holds 150 DPI and surface the cap ("Max 130% — larger would fall below print resolution"). Shrink is always resolution-safe.

### 3.4 Acceptance thresholds (validated)
| Metric | Threshold | In verdict | Backing |
|---|---|---|---|
| `scaleRatioError` | ≤ 0.15 | yes | measured size change matches `f` |
| `paletteDeltaE` (CIEDE2000) | ≤ 5 | yes | dE≤5 = "same color, slightly shifted" — correct palette-preservation tolerance |
| `poseBgDeltaE` | reported | no | mask-quality signal, not op failure |

### 3.5 Fail & refund
Empty fabric raster → helper throws → existing refund. **Add the effect-based no-op parity** (v1 gap #2): a byte-identical scale on a valid mask must also refund. No paid no-op.

### 3.6 Scope guard — the non-repeat guard (see §5; hard pre-live blocker for Scale).

---

## 4. DENSITY — full specification

### 4.1 Definition & invariants (validated, unchanged from v1)
Remove a requested % of motif **instances by count**; survivors byte-identical (size, orientation, position, pixels); removed spots become plain ground; colorway and off-print pixels preserved. **Held constant:** survivor pixels, colorway, off-print. **Changed:** motif count → coverage.

### 4.2 Algorithm (as built and verified — `densityThin.ts`, `4fdfd37`)
Count instances `n`. `removeN = clamp(round(n*percent/100), 0, n)`, **by whole objects, never by area.** Choose removals by deterministic stratified subset selection (grid cells, bucket by centroid, round-robin) for even spread. Erase each by infilling base-cloth color (k-means `k=3` dominant ground, luminance flattened so no ghost on opaque motifs). Survivor-clip invariant: removal region = selected-instance dilated 2px **AND** fabric raster **AND NOT** any survivor. Deterministic.

### 4.3 Parameter — PINNED (validated)
- **User-facing:** **"Reduce density by X%", 0%–90%, default 0%** (a one-directional reduce-by control; anchor 0 at the left; never default to a billable change).
- **Internal:** matches the built `removeN` formula; the existing zod clamp to `[0,90]` (F4) is correct.
- **Step:** 5% drag / 1% keyboard, with a live numeric readout.
- **Why cap at 90%:** practitioners warn that over-thinning "over-exposes the repeat grid and stops being the same print." 90% (≥10% of motifs survive) is "very sparse but still the same print"; never allow 100% (empties the field).

### 4.4 Even distribution — REQUIREMENT + metric (strengthened)
The single biggest real-world risk the research flagged: thinned prints go **patchy** via **tracking** (survivors lining into unintended rows/diagonals), **holes** (empty patches), and **clumps**. Sparse layouts make these *more* visible. The stratified selection already targets this; the spec now **requires** it be measured:
- **Eval metric `evenness ≤ 1.5`** (v1) is retained as the gate.
- **Principled backing / recommended computation:** Average Nearest-Neighbor Index (NNI) on removed-instance centroids — `R = observed mean NN dist / expected-under-random`, where expected `= 0.5/√(n/A)`. `R<1` clustered, `R=1` random, `R>1` dispersed. **Require `R ≥ 1.0`** (ideally ≥1.3) so removals are at least as spread as random, never clustered. Surface the numeric score.

### 4.5 Acceptance thresholds (validated against color science)
| Metric | Threshold | In verdict | Backing |
|---|---|---|---|
| `countError` | ≤ 0.10 | yes | right number removed |
| `survivorIntegrity` (CIEDE2000) | ≤ 2 dE | yes | dE≤1 imperceptible, ≤2 "perceptible only on close inspection" — sound "effectively unchanged" gate; not so tight it flakes on codec/resample noise |
| `evenness` | ≤ 1.5 | yes | see §4.4 |
| `infillCleanliness` | ≤ 2.5 | yes | removed areas read as clean ground |
| `bgDeltaE` | reported | no | same rationale as scale |

**Color-science note:** all deltaE metrics are **CIEDE2000** (JND ≈ 1.0). If any is computed as CIE76, loosen its bound toward ~2.3 (CIE76's coarser, non-uniform JND). Our `color.ts` uses CIEDE2000 — keep it.

---

## 5. The non-repeat guard — full spec (closes v1 gap #1; hard Scale blocker)

v1 operates only on **allover/yardage** prints. Placement/engineered prints (single graphic, border, panel) must be **rejected before any credit is taken** — mirror-tiling or count-thinning a single placed graphic is nonsense.

**Detection (recommended): FFT-propose + autocorrelation-validate.**
1. Detrend/high-pass (kill illumination gradient), 2D Hann window.
2. FFT periodogram → candidate periods/orientations per axis.
3. Validate each candidate with circular autocorrelation (does the ACF actually peak at that lag?). Reject spectral artifacts.

**Composite "is-a-repeat" confidence — classify as a usable allover repeat only if ALL hold:**
- ACF **peak ratio `p = R[bestlag]/R[0] ≥ 0.30`**, and
- **periodicity-energy ≥ 0.50** (fundamental+harmonics / total), and
- **≥ 2 evenly-spaced harmonic peaks on BOTH axes** (inter-peak spacing CV < ~15%), and
- the tile is **observed repeating ≥ 2.5×** across the image on both axes.

**Rejections (charge nothing, clear message):**
- Periodicity on **one axis only** → border/stripe print → reject for v1 (allover requires both axes).
- Single large foreground object on near-uniform ground, or period ≥ ~0.5× image dimension → placement/engineered → reject.
- Near-solid ground (no usable repeat) → reject.

**Output the numeric confidence, not just a boolean**, and **calibrate the threshold on labeled garment data** before go-live (do not ship the constants un-calibrated — that would be a G3-class "gate that doesn't gate"). Server-side: Python sidecar (NumPy/SciPy `fft`/`signal.find_peaks`, scikit-image, the `periodicity-detection` PyPI pkg) is the mature path.

---

## 6. UX / control spec (NEW — pinned)

**Scale control:** % slider, **range 50–200%, default 100% centered**, 5% drag / 1% keyboard, paired numeric field, units label "%", `aria-valuetext` announces "100%". Reset-to-100% affordance. Hard-clamp ends; **show the cap and the reason** (resolution for upscale). 100% = unchanged.

**Density control:** "Reduce density" % slider, **range 0–90%, default 0%**, anchored left, 5% drag / 1% keyboard, **live numeric readout**, numeric field, units "%". Clamp at 90% with reason ("Max 90% keeps the design legible").

**Both:** numeric entry beside the slider; keyboard Arrow = ±1, PageUp/Dn = ±10, Home/End = min/max; `role="slider"` with live `aria-valuenow`/`aria-valuetext`. Never default to a billable/destructive value (density default 0; scale default 100).

---

## 7. Orthogonality & scope (validated, unchanged)
Independent axes; v1 runs them **one at a time**; a job combining scale or density with any other edit is rejected before any credit (D-A). Deterministic chaining is post-v1. Out of scope v1: on-body drape warp, tile-boundary relight beyond the 1px feather, generative relight finish.

---

## 8. Live-wiring rules (locked D-A…D-D, built & merged — unchanged)
Distinct LIVE flags `STUDIO_SCALE_LIVE` / `STUDIO_DENSITY_LIVE` (default off, separate from eval-only flags); engage deterministic op only when provider is rasterReady (SAM2); D-A combined-reject before credit; D-B prompt-fall + WARN if not rasterReady; D-C no-op throw → refund; D-D pricing unchanged. Per the Flip Authority rule, each flag is flipped by Frank alone on an Architect-verified SHA after gates clear.

---

## 9. Fail & refund — no paid no-op (both ops)
Scale: empty raster **+ effect-based parity** (§3.5). Density: empty/missing raster, zero instances, no ground to sample, or removed==0. Each throws → existing refund fires.

---

## 10. Decisions needed (Architect + Frank) before build/flip
1. **Scale max — 150% vs 200%?** Industry idiom supports 200%, but the upscale resolution guard (§3.3) will often clamp below it. Recommend **slider 50–200% with the DPI guard doing the real limiting**, so quality (not an arbitrary cap) governs. Confirm.
2. **Enforce the upscale DPI guard (≥150) now, or warn-only?** Recommend enforce (hard quality floor); flag if you'd rather warn.
3. **Non-repeat guard threshold calibration** — approve building the detector (FFT+ACF, §5) and calibrating on labeled garment images. Hard Scale blocker.
4. **Density even-distribution gate** — adopt NNI `R ≥ 1.0` as the principled backing for `evenness ≤ 1.5`, or keep `evenness` alone?
5. **Min-feature-size (scale-down) advisory** — we don't know the customer's print process; recommend an **advisory** warning only (not a hard block) when shrink would push motif features below a typical screen-print minimum. Confirm advisory vs none.

---

## 11. Known gaps to close before go-live (updated)
1. **Scale non-repeat guard** — §5, hard Scale blocker, build + calibrate.
2. **Scale effect-based no-op parity** — §3.5, add the byte-identical-output refund.
3. **Upscale resolution guard** — §3.3, decide enforce/warn (decision #2).
4. **Eval runners actually execute** — H10 (manifest field-name mismatch) must be fixed; real-garment per-route eval on fixed runners (G3) before any flip.

---

## 12. Research appendix — findings by domain (with sources)

**Terminology / scale-vs-density (confirmed standard; half-drop = 50%; ditsy 0.5–2 cm).**
artlandia.com/wonderland/glossary · sewguide.com/fabric-design-pattern-repeat · patternanddesign.com/7-most-common-surface-pattern-repeats · thecoloralchemy.com/blog/surface-pattern-design-essential-terminology-explained · sinofinetex.com (ditsy 0.5–2 cm)

**Professional CAD (scale = repeat dims in cm/in + %; NO first-class density control; rotary repeat fixed).**
nedgraphics.com/product/design-repeat-software · avacadcam.com/software/create-edit-repeat-textiles · pointcarre.com/dmaker · spgprints.com (circumferences 640/725/819/914/1018 mm)

**Adobe/consumer (scale = % of native, 100% default, PS ~1–1000%; brick offset default 1/2; % slider+numeric).**
helpx.adobe.com/illustrator/.../edit-patterns · helpx.adobe.com/photoshop/.../pattern-preview-best-practices · help.figma.com/.../Use-patterns-as-a-fill-or-stroke · repper.app/en/features

**Print production (rotary circ. 640 mm standard; ≥300 DPI ideal / 150 floor; TAC 240–320%; min feature size; density-term disambiguation).**
textilelearner.net/rotary-screen-making · digitalfabrics.com.au/how-it-works/artwork-requirements · blog.catprint.com (DPI/scaling) · prepressure.com/design/basics/tic · jotamachinery.com/what-is-lpi-in-printing

**Print-on-demand (Spoonflower scale slider+%+inches, 100% ceiling, 150 DPI default; 5 repeat types; no density control).**
support.spoonflower.com/.../204444610-Sizing-Your-Design · .../204444650-Repeat-Options · .../9327411118349-150-DPI · wovenmonkey.com/faq · contrado.com/blog/make-repeating-pattern

**Wallpaper (match types; vertical repeat 0–27″; motif buckets ditsy ≤0.5″, medium 0.5–4″, large >4″).**
tempaper.com/blogs/news/the-differences-between-wallpaper-match-types · dummies.com/.../understanding-wallpaper-pattern-repeats · onlinefabricstore.com/makersmill/fabric-patterns-repeat-and-scale

**Coverage & color science (coverage = fg/total; CIEDE2000 JND≈1, ≤2 close-inspection, ≤5 same-color-shifted — our ≤2/≤5 defensible; k=3–5 LAB; NNI evenness R≥1, max 2.149).**
zschuessler.github.io/DeltaE/learn · en.wikipedia.org/wiki/Color_difference · pro.arcgis.com/.../h-how-average-nearest-neighbor-distance · towardsdatascience.com (k-means color themes)

**Repeat/periodicity detection (FFT+ACF; p≥0.30, periodicity-energy≥0.5, ≥2 peaks/axis, ≥2.5 tiles; border = 1-axis only).**
pypi.org/project/periodicity-detection · arxiv.org/pdf/2208.12151 · hal.science/hal-00449085/document · oksancia.com/repeat-pattern-types-allover-pattern-vs-border-pattern-vs-placement-print

**Fashion scale/sizing (ditsy 0.5–2 cm, small ≤0.5″, medium 0.5–4″, large >4″; 50–200% coordinate idiom; ±20–30% conservative; 100% POD ceiling).**
learnhowtoquilt.com/encyclopedia/fabric-scale · agfblog.com/2020/08/matching-fabrics-part-2-scale · insideoutstyleblog.com/.../how-to-choose-a-print-garment · support.spoonflower.com/.../204444610-Sizing-Your-Design

**AI competitors (numeric scale only in Spoonflower / textile-designer.ai; numeric DENSITY absent industry-wide = our white space; keep scale & density separate named numeric controls).**
patterned.ai · patterned.ai/seamless-fixer · textile-designer.ai · recraft.ai/docs/.../seamless-patterns

**Density-reduction practice (remove instances preserves size; "open up/thin out"; tracking/holes/clumps are the failure modes; remove+infill ground is real; 0–90% defensible; %-by-count is our formalization).**
smittendesign.co.nz/blog/pattern-magic · patternobserver.com/.../eye-catching-tossed-layouts · skillshare.com/.../guide-to-surface-design-and-pattern-design · blog.askingfortrouble.co.uk/.../scattered-patterns

**Percentage-control UX (scale: % of original, 100% center default, 50–200%, 5% step/1% arrow; density: 0–90%, default 0, anchor left; numeric readout; clamp + reason; aria-valuetext).**
nngroup.com/articles/sliders-knobs · m3.material.io/components/sliders/guidelines · designsystem.digital.gov/components/range-slider · developer.mozilla.org/.../ARIA/Reference/Roles/slider_role
