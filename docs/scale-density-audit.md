# Scale & Density — build audit

**Date:** 2026-06-20 · **Branch:** `claude/jolly-pascal-k9tw4r` · **PR:** #1

**Bottom line: Scale and Density are spec-complete, code-zero.** Every deterministic
line shipped so far is on the recolor axis (A1). Neither Scale nor Density has an
op, an eval, or a deterministic route. Both are gated on a mask foundation that
does not exist yet (`rasterReady` is false on both providers), and the first
domino is D1.

## Current runtime behavior (both controls)

- Scale and Density still route through the **original prompt path**:
  `buildInstruction` (`shared/controls.ts:121/144` SHRINK/ENLARGE, `:164` DENSITY
  DELETE %) → `generateEditedImage` (`studio.ts:201`). That path is the broken one
  — the model can't do geometric scaling or motif counting, so output ≈ input.
- The **Tier 0 no-op guard catches them**: no-op edit → retry → throw → **refund**.
  Pre-launch they fail honestly rather than billing. The product still cannot
  perform either operation.

## What exists that Scale/Density will reuse

| Asset | State |
|---|---|
| `decodeUpright` (EXIF boundary) | ✅ built, reusable by both ops |
| `sharp` (spike S3) | ✅ verified |
| `kmeans` | ✅ built (reusable for scale repeat / palette) |
| Mask interface seam | ✅ `getFabricMask` → real **bbox**; **`getInstanceMasks` throws** in both providers |
| `rasterReady` (precise pixel masks) | ❌ **false** on both providers |
| Swatch fallback spec | 📄 `docs/scale-hybrid-plan.md` — design only, no code |
| Recolor eval infra (truth mask, side-by-side PNG, harness) | ✅ reusable scaffolding for scale/density evals |

## Scale — what's left

Planned (dossier §7 / Amendment 1): fabric mask → extract repeat patch (FFT
autocorrelation lattice, or pragmatic patch resample) → resample to exact
`targetPct = 100 + percent` → composite into the mask, displacement-warped by
fabric luminance to follow drape → generative relight.

1. **Path decision:** mask-composite (needs `rasterReady`) vs **swatch fallback**
   (needs spike **S1**, "does Forge use a 2nd reference image?" — **unrun**).
2. **Build `ops/scaleRepeat.ts`** — none exists.
3. **Generative relight** — bounded by the Forge image model (spike **S4/D2**, unrun).
4. **Scale eval harness** — none built (spec below).
5. **Wiring** — no `STUDIO_DETERMINISTIC_SCALE` flag, no route.

## Density — what's left (more blocked than Scale)

Planned: fabric mask → localize instances (template-match / SAM2 automatic masks,
**not** LLM centroids) → select X% evenly (blue-noise) → erase + infill with sampled
inter-motif ground color.

1. **`getInstanceMasks` is the hard blocker** — interface exists but
   `classicalProvider` throws `MaskNotImplementedError` (needs template-match +
   sharp) and `sam2Provider` throws `MaskProviderUnavailableError`. **Density has
   no non-segmentation path** (Amendment 1 §13.2: a swatch encodes *frequency*,
   not *count*) → it is the control that **forces the SAM2/mask tier**.
2. **Build `ops/densityThin.ts`** — none exists.
3. **Density eval harness** — none built (spec below).
4. **Wiring** — no flag, no route.
5. **"Delete %" semantics ruling** — not yet specced (density analog of the
   coverage ruling).

## Cross-cutting gates (block both)

- **D1 (mask tier: classical floor vs SAM2 hosting)** — unresolved. Needs the
  warm-on-wood `offBg` + **S5** segmentation quality. Density (mandatory) likely
  forces SAM2.
- **`rasterReady` false** — scale's composite and all of density need raster masks.
  Classical raster needs **GrabCut/OpenCV** (heavier than sharp); SAM2 needs hosting.
- **Spikes S1, S4/D2** — unrun; gate scale's fallback and relight.
- **Build order recolor → scale → density**, and A2 (recolor live) is itself
  pending D1. So Scale/Density haven't started *by design*.

## Critical path

Resolve **D1** (warm-on-wood + S5) → flips `rasterReady` via the chosen provider →
*then* scale/density ops build against the raster mask, each with its own eval
harness (spec'd in `docs/scale-density-eval-spec.md`) and magnitude-semantics
ruling. Density can't begin until `getInstanceMasks` is real (→ SAM2). Per build
order, neither starts before A2 wires recolor live.
