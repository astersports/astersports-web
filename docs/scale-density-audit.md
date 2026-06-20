# Print Studio — Scale & Density Audit

**Date:** June 19, 2026  
**Scope:** Review all code in `astersports-landing` (main) and `claude/jolly-pascal-k9tw4r` (PR #1) related to Scale and Density controls.

---

## Executive Summary

**Scale** has two parallel implementations — neither is wired to the live router correctly yet. **Density** has no deterministic implementation at all — it's still AI-prompt-only, which (per Claude's own analysis) "fails (proven by identical output)."

---

## 1. Scale — Current State

### What Exists (3 competing approaches):

| # | Approach | Location | Status | Wired to Router? |
|---|---|---|---|---|
| 1 | **AI-prompt-only** (textile terminology) | `shared/controls.ts` lines 112-157 | Deployed | Yes — used when Scale is combined with other controls |
| 2 | **Hybrid SAM2 pipeline** (Manus-built) | `server/hybridScale.ts` + `server/replicateClient.ts` | Deployed | Yes — used when Scale is the ONLY active control |
| 3 | **Swatch-reference plan** (Claude's architecture) | `docs/scale-hybrid-plan.md` | Spec only | No — never implemented |

### Approach 1: AI-Prompt-Only (PROVEN BROKEN)

- **File:** `shared/controls.ts` lines 112-157
- **How it works:** Generates a text prompt like "Redraw at tiny miniature ditsy-scale" and sends it to the Forge image model with the original image
- **Result:** Produces output identical to input. User confirmed "looks exactly the same before and after" at -50%.
- **Why it fails:** Autoregressive image models cannot execute precise geometric transformations. They interpret prompts creatively and prioritize preservation constraints over scale changes.
- **Still used when:** Scale is combined with Density/Remove/Recolor (the `isScaleOnly` check is false)

### Approach 2: Hybrid SAM2 Pipeline (UNTESTED IN PRODUCTION)

- **Files:** `server/hybridScale.ts`, `server/replicateClient.ts`
- **How it works:** 
  1. Sends image to Replicate's SAM2 for automatic mask generation
  2. Downloads individual masks, filters by area (>200px)
  3. For each mask: extracts motif, resizes with Sharp, composites back
  4. Fills background gaps with dominant color
  5. Stores result in S3
- **Router integration:** `server/routers/studio.ts` line 195-213 — only fires when `isScaleOnly === true`
- **Status:** Code is deployed but **has never been tested end-to-end with a real user action** (no evidence of a successful run in logs or eval results)
- **Risk:** SAM2 automatic mask generation may not cleanly separate individual motifs on dense prints. The "dominant background color" infill is naive (single color fill, no texture matching).

### Approach 3: Swatch-Reference (SPEC ONLY, NEVER BUILT)

- **File:** `docs/scale-hybrid-plan.md`
- **Concept:** Extract a fabric patch, tile it at the target scale to create a "swatch," send both garment + swatch as two images to the AI model (image-2 reference transfer)
- **Status:** Gated on "Phase 0" — testing whether the Forge model even respects a second reference image. Phase 0 was never run.
- **Verdict:** Abandoned in favor of the hybrid SAM2 approach

### What's Missing for Scale:

1. **No production test** — the hybrid pipeline has never been triggered by a real user. We don't know if SAM2's automatic masks work on garment prints.
2. **Combined controls fallback is broken** — when Scale + Recolor are both active, it falls back to the AI-prompt path (Approach 1), which is proven to produce no visible change.
3. **No eval harness for Scale** — the eval only covers Recolor (separationRemap). There's no acceptance metric for "did the motifs actually get smaller?"
4. **No deterministic Scale op** — Claude's architecture (`server/_core/studio/ops/`) has `separationRemap.ts` for Recolor but nothing for Scale. The hybrid pipeline (`server/hybridScale.ts`) is a separate, disconnected implementation.

---

## 2. Density — Current State

### What Exists:

| # | Approach | Location | Status | Wired to Router? |
|---|---|---|---|---|
| 1 | **AI-prompt-only** | `shared/controls.ts` lines 160-178 | Deployed | Yes — the ONLY path |
| 2 | **Mask interface stub** (for future deterministic) | `server/_core/masking/types.ts` line 45-66 | Interface defined | No implementation |

### Approach 1: AI-Prompt-Only (PROVEN BROKEN)

- **File:** `shared/controls.ts` lines 160-178
- **How it works:** Generates a prompt like "DELETE 50% OF ALL MOTIFS FROM THE FABRIC" and sends to Forge
- **Result:** Per Claude's own Amendment 1 §13.2: "Prompt-only: fails (proven by identical output)"
- **Why it fails:** Same as Scale — the model cannot reliably count, select, and erase specific motifs. It either ignores the instruction or makes imperceptible changes.

### Architecture for Deterministic Density (DESIGNED, NOT BUILT):

Per `server/_core/masking/types.ts`:
```typescript
/** Mask of one localized print motif instance (for density). */
export interface InstanceMask {
  bbox: BBoxNormalized;
  raster?: RasterMask;
}

/** Localize individual motif instances within the fabric region (density). */
getInstanceMasks(image: MaskImageInput, fabric: FabricMask): Promise<InstanceMask[]>;
```

The **intended pipeline** (from `docs/collaboration-next-steps.md`):
1. Get fabric region mask (SAM2 or classical bbox)
2. Localize individual motif instances (SAM2 automatic masks OR template matching)
3. Select X% of instances to delete (random, evenly distributed)
4. Erase selected instances (paint with background)
5. Infill the erased areas (texture-match or AI cleanup)

### What's Missing for Density:

1. **No implementation whatsoever** — only the interface exists
2. **`getInstanceMasks()` throws** in both providers:
   - `classicalProvider`: throws `MaskNotImplementedError` ("requires raster ops via sharp — gated on spike S3/S5")
   - `sam2Provider`: throws `MaskProviderUnavailableError` ("gated on D1 tier decision")
3. **No eval harness** — no metrics defined for density (motif count accuracy, spatial distribution of deletions)
4. **No fallback** — when density is enabled, it always goes through the broken AI-prompt path
5. **Template matching not implemented** — Claude recommended normalized cross-correlation for instance localization, but no code exists

---

## 3. Claude's Latest Unmerged Code (commit `8eddb0d`)

Our project has the truth-mask decoupling (`0e94c53`) but NOT the latest commit (`8eddb0d` — cluster selection fix). This commit:
- Replaces per-pixel distance ramp with k-means cluster membership selection
- Uses ΔE2000 from `fromColor` to each centroid to decide which clusters are "selected"
- Applies a thin fixed ~1px feather via Sharp blur (not coverage-scaled)
- Fixes a Sharp stride bug (multi-channel output from 1-channel input)

**Impact:** This is a significant quality improvement for Recolor. Our version still uses the older selection-tolerance approach (per-pixel distance with smoothstep antialias). Should be merged.

---

## 4. Gap Analysis — What's Left to Build

### Scale (Priority: HIGH — mandatory for launch)

| Task | Effort | Dependency |
|---|---|---|
| Test hybrid SAM2 pipeline end-to-end on real garment | 1 day | Replicate token (done) |
| Handle combined Scale + other controls (currently falls back to broken AI path) | 1-2 days | Decision: chain hybrid scale first, then AI for other controls? |
| Build Scale eval harness (motif size ratio metric) | 1 day | Sample images |
| Improve background infill (texture-aware, not single-color) | 2-3 days | Sharp + possibly AI cleanup pass |

### Density (Priority: HIGH — mandatory for launch)

| Task | Effort | Dependency |
|---|---|---|
| Implement `getInstanceMasks()` in SAM2 provider (call Replicate) | 1-2 days | Replicate token (done) |
| Build deterministic density pipeline (select → erase → infill) | 3-4 days | Instance masks working |
| Wire density pipeline into studio router (like `isScaleOnly` but for density) | 0.5 day | Pipeline built |
| Build Density eval harness (motif count accuracy) | 1 day | Pipeline built |
| Handle combined Density + other controls | 1 day | Pipeline built |

### Recolor (Priority: MEDIUM — mostly done, needs wiring)

| Task | Effort | Dependency |
|---|---|---|
| Merge commit `8eddb0d` (cluster selection fix) | 0.5 day | None |
| Wire `separationRemap` into studio router behind `STUDIO_DETERMINISTIC_RECOLOR` flag | 1 day | None |
| Implement SAM2 provider for pixel-precise fabric masks (replace bbox) | 1-2 days | Replicate token (done) |

---

## 5. Architecture Conflicts Between Implementations

There are **two parallel SAM2 integrations** that don't talk to each other:

1. **Manus-built:** `server/replicateClient.ts` + `server/hybridScale.ts` — calls Replicate directly, returns mask URLs
2. **Claude-designed:** `server/_core/masking/` — abstract interface with classical/sam2 providers, the sam2Provider is a stub that throws

These need to be unified. The Claude architecture is better designed (interface-driven, swappable providers), but the Manus implementation actually works (calls Replicate, gets masks). The path forward is to implement Claude's `sam2Provider` interface using the working Replicate client code.

---

## 6. Recommendations

1. **Merge `8eddb0d`** immediately — it's a pure quality fix for Recolor with no risk.
2. **Wire Recolor to production** — flip `STUDIO_DETERMINISTIC_RECOLOR=true` and route recolor-only operations through `separationRemap`. This is the closest to "done."
3. **Test hybrid Scale** — trigger it from the UI and inspect the output. If SAM2 masks are good, it may already work. If not, tune parameters.
4. **Build Density next** — it's the biggest gap. Use Replicate SAM2 for instance masks (the model already does automatic mask generation which is exactly "find all motifs"). The pipeline is: get all instance masks → randomly select X% → erase with background → optional AI polish.
5. **Unify SAM2 code** — implement `sam2Provider` in the masking interface using the existing `replicateClient.ts` code. Then both Scale and Density can use the same mask source.

---

## 7. Files Reference

### Scale-related:
- `shared/controls.ts` — AI prompt generation (broken for scale)
- `server/hybridScale.ts` — Hybrid SAM2 pipeline (untested in prod)
- `server/replicateClient.ts` — Replicate SAM2 client
- `server/routers/studio.ts:195-213` — Router routing logic
- `docs/scale-hybrid-plan.md` — Swatch reference spec (abandoned)

### Density-related:
- `shared/controls.ts` — AI prompt generation (broken)
- `server/_core/masking/types.ts` — Interface for instance masks (stub)
- `server/_core/masking/classicalProvider.ts` — Throws "not implemented"
- `server/_core/masking/sam2Provider.ts` — Throws "not provisioned"

### Recolor-related (for context):
- `server/_core/studio/ops/separationRemap.ts` — Deterministic A1 (works, not wired to router)
- `server/_core/studio/ops/color.ts` — Color math (LAB, ΔE2000)
- `server/_core/studio/ops/kmeans.ts` — K-means clustering
- `server/_core/studio/ops/membership.ts` — Fabric pixel membership
- `server/_core/studio/eval/` — Eval harness (recolor only)
- `server/_core/masking/locateFabricRegion.ts` — Vision-LLM bbox locator
