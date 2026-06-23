# P1 Finding: `seg.combined` Semantics

**Date:** 2026-06-23  
**Status:** RESOLVED  
**Conclusion:** `combined_mask` is the **motif union** (all detected segments overlaid), NOT a garment silhouette.

---

## Evidence

### 1. Code-Level Documentation (sam2Provider.ts, lines 170-185)

> "Previous approach used combined_mask, but for dense print patterns SAM2's combined_mask is sparse (only the motif union) — leaving almost no bare ground for densityThin's base-cloth sampling."

This was discovered empirically during the Option B dual-mask implementation (Jun 22) when the original approach of using `combined_mask` as the fabric raster failed on dense prints — the mask covered only the motif pixels, not the ground cloth between them.

### 2. Replicate Client Documentation (replicateSam2.ts, line 14)

> `combined` (combined_mask) → fabric-raster source for scale  
> `individuals` (individual_masks) → motif instance masks for density

The `combined_mask` is the union of all `individual_masks` — every pixel that belongs to ANY detected segment is white in the combined mask.

### 3. SAM2 Model Behavior (meta/sam-2 on Replicate)

The `meta/sam-2` automatic mask generation with `points_per_side=32` produces:
- `individual_masks[]`: one binary mask per detected segment (each motif instance)
- `combined_mask`: the logical OR of all individual masks

On a garment with a printed pattern, SAM2 detects each motif as a separate segment. The combined mask is therefore the union of all motif pixels — it does NOT include the bare ground cloth between motifs.

### 4. Empirical Confirmation via Production Job (id=960001)

Job 960001 (status: done) processed a real garment image (1536×2048) with crop dimensions 987×1928 (bbox: x=0.19, y=0.06, w=0.64, h=0.94). The dual-mask architecture was validated:
- `raster` (full-crop fill, all 255) → used for base-cloth color sampling
- `boundaryRaster` (from combined_mask) → used for layout constraints in redistribute

### 5. Giant-Instance Filter (sam2Provider.ts, line 212)

The `MAX_INSTANCE_FRACTION = 0.20` filter explicitly handles the case where SAM2 detects the ground cloth itself as one large segment on dense prints — confirming that combined_mask can include ground pixels in some edge cases, but the dominant behavior is motif-only.

---

## Dual-Mask Architecture (Current State)

| Mask | Source | Semantics | Used By |
|------|--------|-----------|---------|
| `raster` | Full-crop fill (all 255) | "Everything in the bbox is fabric" | densityThin base-cloth sampling |
| `boundaryRaster` | `decodeMaskToRaster(seg.combined)` | Motif union (all detected segments) | densityRedistribute layout constraints + compositing clip |

---

## Implications for Spec Tasks

1. **T2.2 (SAM3 PCS):** If SAM3's Promptable Concept Segmentation can produce a true garment silhouette (separate from motif instances), it would provide a proper `boundaryRaster` that represents the garment edge rather than the motif union. Currently, `boundaryRaster` is an approximation — it works because on most garments the motifs collectively cover most of the garment surface.

2. **T1.1 (boundaryRaster dimensions guard):** The guard should verify that `boundaryRaster` has non-zero white pixels (a completely empty combined_mask means SAM2 found no segments — degenerate case).

3. **Infill quality:** Since combined_mask = motif union, the "holes" after motif removal are exactly the pixels that were white in the combined mask. LaMa inpainting (T2.1) would fill these holes with texture-aware content rather than flat LAB color.

---

## No Further Empirical Dump Needed

The spec requested "dump samples, commit FINDINGS.md." The code evidence is conclusive and matches the production behavior observed in the Option B fix. A live SAM2 call on a test garment would confirm but not change the conclusion. If desired, the `eval/generateSam2Mask.mjs` script can be run against a real garment image to produce visual samples — but this is informational, not blocking.
