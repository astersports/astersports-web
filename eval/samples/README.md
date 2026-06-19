# A1-EVAL — deterministic recolor eval

Offline acceptance gate for A1 (separation remap) **and** the D1 evidence on the
recolor axis. No UI, no router change. Reuses the shipped op + metrics.

## Populate the manifest

Edit `recolor.manifest.json` (an array; see `recolor.manifest.example.json`).
Each case:

| field | meaning |
|---|---|
| `id` | short unique label (becomes the artifact filename) |
| `imageUrl` | `/manus-storage/...` key or a fetchable URL of your own sample garment |
| `fromColor` | source color of the separation to change (hex / CSS) |
| `toColor` | target color (hex / CSS) |
| `coverage` | 10..100 (soft-assignment radius) |
| `note` | optional |

**Include the hard cases — they're the point:** busy/overlapping florals, two
nearby colors, colored (non-white) backgrounds, on-body shots.

### Field: `bbox` (optional) — offline mode

Add a normalized `bbox` (`{ x, y, w, h }`, 0..1) to a case to **skip the
vision-LLM fabric mask and run fully offline — no Forge creds**. `imageUrl` may
then be a **local filesystem path** (or `file://`). Without `bbox`, the harness
calls the mask provider (needs Forge). Offline mode is the fast loop for tuning
on your own images; the auto-bbox mode is the production-faithful path.

## Run

```
# Offline (manual bbox + local image, no creds):
npx tsx server/_core/studio/eval/recolorEval.ts path/to/manifest.json

# Auto fabric mask (vision LLM) — needs Forge creds:
export BUILT_IN_FORGE_API_URL=...   BUILT_IN_FORGE_API_KEY=...
npx tsx server/_core/studio/eval/recolorEval.ts
```

Artifacts (side-by-side before/after PNGs) are written to `eval/out/` (gitignored).

## Metrics & thresholds

- **target ΔE2000 ≤ 5** — chroma/hue of the remapped separation vs target, measured
  **at each pixel's own L** (A1 preserves luminance, so a flat ΔE to the target
  would falsely fail a correct navy-rose that keeps bright highlights).
- **luminance SSIM ≥ 0.95** — L channel source vs out over the target set (A1 holds
  L exactly, so this guards regressions; expect ~1.0).
- **off-target ΔE2000 ≤ 2** — change on fabric pixels far from the source color +
  all background. This is the **bleed metric and the raster signal**.

The harness splits pixels by the source color's distance to `fromColor`
(default radius ΔE ≤ 15), independent of the op, so bleed is measured honestly.

## The RASTER-NEEDED list

Cases that **pass target + lum but FAIL off-target on bbox-only** are the D1
recolor evidence: they quantify how much the precise fabric mask
(`rasterReady` / S5) is required for recolor quality, separate from scale/density.
When `rasterReady` flips (post-S3 GrabCut or SAM2), re-run the same manifest and
report the off-ΔE delta — no op change (A1 already reads `fabric.raster`).

## Acceptance to wire A1 live (at A2)

target + lum pass on real samples; off-ΔE failures characterized as bbox-only
artifacts that the raster mask resolves.
