# Print Studio — Spike Week harness

Throwaway, runnable scripts for the Amendment 1 spike. **Spike-only — safe to delete after the go/no-go doc is produced.** These are *not* part of the product build.

Authored by the Builder lane but **not run** here (this environment has no Forge
credentials, no sample garments, and no SAM2 host). Run them in a credentialed
runtime on Frank's own sample images. They are self-contained (`node`, no project
imports) except `s5_segmentation.mjs`, which uses `sharp` (already added in S3) to
save bbox crops for visual review.

## Required env

```
export BUILT_IN_FORGE_API_URL=...     # same value the app uses
export BUILT_IN_FORGE_API_KEY=...
# S5 SAM2 arm only (optional; skipped if unset):
export SAM2_API_URL=...               # hosted SAM2 endpoint (fal.ai/Replicate/self-host)
export SAM2_API_KEY=...
```

## Run

```
node scripts/spike/s4_models.mjs                                   # S4: model id (answers D2)
node scripts/spike/s2_seed.mjs path/to/garment.jpg                # S2: seed accept/ignore/reject + reproducibility
node scripts/spike/s1_reference_image.mjs garment.jpg swatch.png  # S1: does image-2 transfer?
node scripts/spike/s5_segmentation.mjs ./samples/*.jpg            # S5: classical bbox arm (+ SAM2 if env set)
```

## Two flags the Builder is raising on the spec

1. **S5 Arm A is not "sharp + GrabCut" — GrabCut is OpenCV, not sharp.** sharp has
   no GrabCut. The classical *raster* mask needs an OpenCV binding (native
   `opencv4nodejs`, or a wasm build like `@techstark/opencv-js`), which is a
   heavier dependency than sharp-only. This **matters for the D1 tier economics**:
   the "classical floor" is not free of native-dep risk. `s5_segmentation.mjs`
   therefore only exercises the **bbox** arm (vision LLM, real today) and saves
   crops for eyeballing; a GrabCut raster prototype needs that extra dep first.
2. **SAM2 arm needs a host.** Pre-launch this is fine on Frank's samples (no
   privacy constraint). The script calls a generic `SAM2_API_URL`; adapt the
   request/response shape to whichever host is chosen.

## Output

Each script prints structured results to stdout and writes artifacts to
`scripts/spike/out/`. Collate into the one-page go/no-go doc (format in the
spike-week prompt): S1 pass/fail, S2 accepted/ignored/rejected + reproducible,
S3 loads y/n (✅ done — see `server/sharp-smoke.test.ts`), S4 model id + finish
quality, S5 per-garment classical-vs-SAM scores + **tier recommendation**.
