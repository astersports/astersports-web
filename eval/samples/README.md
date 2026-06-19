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

Pixels are split by the **source** color's distance to `fromColor` (op-agnostic),
into three bands plus the fabric/background split:

- **target** (`ΔE2000(source, fromColor) ≤ near`, default 15) — the separation.
- **excluded band** (`near < ΔE ≤ far`, default 40) — the op's intended soft
  antialiased edge. **Scored by neither metric** (else correct antialiasing reads
  as bleed).
- **off-target** (`ΔE > far`, or background) — split below because only one half
  is mask-fixable.

Metrics:
- **target ΔE2000 ≤ 5** — chroma/hue of the remapped separation vs target, measured
  **at each pixel's own L** (A1 preserves luminance, so a flat ΔE to the target
  would falsely fail a correct navy-rose that keeps bright highlights).
- **luminance SSIM ≥ 0.95** — L channel source vs out over the target set (~1.0).
- **offBg ΔE2000 ≤ 2** — change on **background** pixels (membership 0). A precise
  fabric mask fixes this → **the only D1 raster signal**.
- **offFab ΔE2000 ≤ 2** — change on **far-from-source fabric** pixels (e.g. pink
  dragging the red rims). A mask can't fix this (both are inside the fabric) →
  **op-tuning** (reduce radius at high coverage), NOT raster.

## Two lists, two different fixes

- **RASTER-NEEDED** = pass target+lum but FAIL **offBg**. The D1 recolor evidence
  for the precise mask (`rasterReady` / S5).
- **OP-TUNING** = pass target+lum but FAIL **offFab**. Drop the soft radius; do
  **not** read as needing SAM 2.

A single bbox run is an **A1 acceptance** read, not D1 evidence. The definitive
raster signal is the **bbox-vs-raster delta** on the same image (lands when
`rasterReady` flips — re-run the same manifest, no op change). One trap no number
catches: in-bbox background that is color-near `fromColor` folds into the target
set and is silently recolored — **read the PNGs**, they're primary for interpretation.

## Acceptance to wire A1 live (at A2)

target + lum pass on real samples; off-ΔE failures characterized as bbox-only
artifacts that the raster mask resolves.
