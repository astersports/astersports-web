# Print Studio — Hybrid "Scale" Pipeline (Execution Spec)

> **Audience:** an autonomous coding agent (Manus) implementing this end to end.
> **Branch:** `claude/jolly-pascal-k9tw4r`
> **Status:** Phase 0 is a **go/no-go gate** — do not build Phases 1–3 until Phase 0 passes.

---

## 1. Problem

The Print Studio **Scale** control (e.g. "reduce motifs by −50%") produces output
that looks identical to the input. The **Remove** and **Recolor** controls work
correctly through the same image API.

### Root cause (already diagnosed — do not re-investigate)

Scale is a different *class* of edit than the controls that work:

| Control  | Transformation     | Why it works / fails |
|----------|--------------------|----------------------|
| Recolor  | local, appearance  | change hues inside existing shapes — model keeps geometry ✅ |
| Remove   | local, appearance  | erase regions + infill — model keeps geometry ✅ |
| Scale    | **global, geometry** | re-synthesize the *entire* fabric surface at a new spatial frequency while the draped 3D garment stays fixed ❌ |

Instruction-tuned image editors (the family Forge's `ImageService` wraps) are
trained mostly on *local appearance edits* and **anchor hard to the source
image**. That anchoring is exactly why Remove/Recolor preserve garment pose so
well — and exactly why Scale fails: shrinking every motif requires the output to
deviate from the source at *every fabric pixel*, which the model's strongest
prior resists. It resolves the conflict by copying the input.

The current prompt makes it worse by giving the model explicit permission to do
nothing — see `shared/controls.ts:237`:
`"If you cannot perform the edit without moving the garment, return the image unchanged..."`

### Strategy

Stop asking the model to *imagine* "50% smaller." **Programmatically manufacture
a swatch of the print at the exact target scale**, then ask the edit model to
**match a reference** (an in-distribution style/reference-transfer task) instead
of performing abstract geometry (out-of-distribution).

```
 original garment ─► [1] locate clean fabric patch (vision LLM, bbox)
        │                         │ bbox
        │                         ▼
        │            [2] crop patch ─► downscale pattern ─► tile back  (sharp, EXACT 50%)
        │                         │ scale-swatch.png
        ▼                         ▼
 [3] edit model: originalImages=[garment, swatch]
     "re-print fabric in image 1 to match the motif scale in image 2; garment frozen"
        │
        ▼
   scaled result
```

---

## 2. Constraints discovered in the codebase (load-bearing)

- **No raster library is installed.** `sharp`/`jimp`/`canvas` are all absent from
  `package.json`. Phase 1 adds `sharp`.
- **The vision path returns text/JSON only.** `invokeLLM` (`server/_core/llm.ts`)
  and `detectPrintElements` (`server/aiEngine.ts:47`) can describe and bound-box,
  but **cannot produce pixel-accurate masks**. No segmentation model is exposed by
  Forge. This rules out the textbook "segment → UV-unwrap → reproject" hybrid.
- **`original_images` is already an array.** `server/_core/imageGeneration.ts:67`
  POSTs `original_images: options.originalImages || []`. The client can send a
  second reference image **today**; the open question is whether the *backend
  model uses it*. That is what Phase 0 tests.
- **Build is esbuild with `--packages=external`** (`package.json` `build` script),
  so a native module like `sharp` stays external at bundle time — fine, but it
  must install in the runtime/web environment (Phase 0 also checks this).
- **Tests:** vitest. Existing example: `server/studio.test.ts` covers
  `buildInstruction`. New pure-logic code must ship with tests in the same style.

---

## 3. Files (current state → change)

| File | Current role (line refs) | Change |
|------|--------------------------|--------|
| `package.json` | deps | add `sharp` |
| `server/_core/imageGeneration.ts` | `generateImage()`, multi-image array already supported (`:36`, `:67`) | **no change** |
| `server/_core/imagePatch.ts` | — (new) | `extractPatch`, `buildScaleSwatch` — all sharp logic, unit-testable, no network |
| `server/aiEngine.ts` | `detectPrintElements` (`:47`), `downloadImageAsBase64` (`:111`), `generateEditedImage` (`:149`) | add `locateFabricPatch()` (vision) + `generateScaledImage()` orchestrator |
| `shared/controls.ts` | `buildInstruction` (`:109`), scale branch (`:134`), `TEXTILE_PREAMBLE` (`:91`), output reqs (`:230`) | reference-style scale prompt; scale path must **not** inherit the "return unchanged" escape hatch |
| `server/routers/studio.ts` | `generate` (`:96`) calls `generateEditedImage` (`:200`); `rerun` (`:375`) at `:414` | route scale-enabled jobs through `generateScaledImage`; keep `generateEditedImage` for non-scale |

---

## 4. Phase 0 — go/no-go spike (DO THIS FIRST)

**Goal:** prove two assumptions before any real build. ~1 day. If either fails,
**stop and report** — the architecture must change (see §8).

### 4.1 Does `sharp` install & run in this environment?
- Add `sharp` to `package.json`, install, and run a trivial script that loads a
  buffer, resizes it, and writes a PNG. Confirm it works in the same runtime the
  server uses (native binaries must be permitted).

### 4.2 Does the Forge edit model actually USE a second reference image?
This is the decisive test. Build a throwaway script (not wired into the app):

1. Take any garment photo (`A`).
2. Make an obviously different second image `B` — e.g. a solid red square, or a
   swatch with a clearly different/smaller pattern.
3. Call `generateImage({ prompt, originalImages: [A, B] })` with a prompt like:
   *"Image 1 is a garment. Image 2 is the target fabric print. Re-print the
   fabric in image 1 to match image 2. Keep image 1's shape, pose and lighting."*
4. **Inspect the output by eye.** Does the fabric in the result reflect image 2 at
   all (color/pattern/scale), or is image 2 ignored?

**Decision gate:**
- ✅ Output reflects image 2 → proceed to Phase 1 (reference-guided design holds).
- ❌ Image 2 ignored → **STOP.** The reference leg collapses. Report back; the
  only reliable remaining path needs fabric segmentation, which Forge does not
  provide (see §8). Do not attempt Phases 1–3.

Record the test images, prompt, and output in the PR description.

---

## 5. Phase 1 — programmatic swatch builder (~2–3 days)

Create `server/_core/imagePatch.ts`. Pure, deterministic, no network — fully
unit-testable.

```ts
import sharp from "sharp";

export interface BBox {
  /** All normalized 0..1 relative to image width/height. */
  x: number; y: number; w: number; h: number;
}

/** Crop a normalized bbox out of an image buffer. Returns PNG bytes + pixel dims. */
export async function extractPatch(
  image: Buffer,
  bbox: BBox
): Promise<{ patch: Buffer; width: number; height: number }> {
  const meta = await sharp(image).metadata();
  const W = meta.width!, H = meta.height!;
  // Clamp + convert to integer pixel rect; guard against zero-area.
  const left = Math.round(clamp01(bbox.x) * W);
  const top = Math.round(clamp01(bbox.y) * H);
  const width = Math.max(1, Math.round(clamp01(bbox.w) * W));
  const height = Math.max(1, Math.round(clamp01(bbox.h) * H));
  const patch = await sharp(image)
    .extract({ left, top, width: Math.min(width, W - left), height: Math.min(height, H - top) })
    .png()
    .toBuffer();
  return { patch, width, height };
}

/**
 * Build a swatch that shows the SAME print at a smaller repeat.
 * remainingScalePct = 100 - abs(scalePercent), e.g. -50% => 50.
 * Approach: shrink the patch to remainingScalePct, then tile it to refill the
 * original patch dimensions so motifs are physically smaller at the same canvas size.
 */
export async function buildScaleSwatch(
  patch: Buffer,
  patchWidth: number,
  patchHeight: number,
  remainingScalePct: number
): Promise<Buffer> {
  const factor = clamp(remainingScalePct, 10, 100) / 100;
  const tileW = Math.max(1, Math.round(patchWidth * factor));
  const tileH = Math.max(1, Math.round(patchHeight * factor));
  const tile = await sharp(patch).resize(tileW, tileH, { fit: "fill" }).png().toBuffer();

  // Tile across a canvas of the original patch size.
  const composites = [];
  for (let y = 0; y < patchHeight; y += tileH) {
    for (let x = 0; x < patchWidth; x += tileW) {
      composites.push({ input: tile, left: x, top: y });
    }
  }
  return sharp({
    create: { width: patchWidth, height: patchHeight, channels: 3, background: "#ffffff" },
  }).composite(composites).png().toBuffer();
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const clamp01 = (v: number) => clamp(v, 0, 1);
```

### Phase 1 acceptance (unit tests, `server/imagePatch.test.ts`)
- `extractPatch` returns a buffer whose pixel dims equal the bbox×image dims
  (within ±1px rounding); clamps out-of-range bbox to image bounds; never throws
  on zero/negative w/h (clamps to ≥1).
- `buildScaleSwatch` with `remainingScalePct=50` produces a canvas of the same
  dims as the input patch, decodable by `sharp`, with a tile count of
  ~`ceil(1/0.5)^2 = 4`. Assert output metadata dims, not pixels.
- `remainingScalePct` is clamped to `[10,100]`.
- All tests run with no network and no env vars.

---

## 6. Phase 2 — vision bbox + orchestrator (~2 days)

### 6.1 `locateFabricPatch()` in `server/aiEngine.ts`
Mirror `detectPrintElements` (`server/aiEngine.ts:47`): resolve a signed URL for
`/manus-storage/` keys, call `invokeLLM` with a strict JSON schema returning a
normalized bbox over the **flattest, most frontal, least-folded** printed-fabric
region (avoid seams, edges, deep shadow, hanger). Schema:

```ts
response_format: {
  type: "json_schema",
  json_schema: {
    name: "fabric_patch",
    strict: true,
    schema: {
      type: "object",
      properties: {
        x: { type: "number" }, y: { type: "number" },
        w: { type: "number" }, h: { type: "number" },
        confidence: { type: "number" },
      },
      required: ["x", "y", "w", "h", "confidence"],
      additionalProperties: false,
    },
  },
}
```
Return a typed `BBox` + confidence. On parse failure, return `null`.

### 6.2 `generateScaledImage()` in `server/aiEngine.ts`
Signature mirrors `generateEditedImage` (`server/aiEngine.ts:149`) so the router
swap is trivial:

```ts
export async function generateScaledImage(
  originalImageUrl: string,
  remainingScalePct: number,   // 100 - abs(percent)
  instruction: string,         // reference-style scale prompt from buildInstruction
  mimeType = "image/jpeg",
): Promise<string>
```

Steps:
1. Download original as base64 (reuse `downloadImageAsBase64`, `aiEngine.ts:111`).
2. `locateFabricPatch()`; if `null` or `confidence < 0.4`, use a **center-crop
   default** bbox `{x:0.3,y:0.3,w:0.4,h:0.4}` (Fallback ladder rung 1).
3. `extractPatch` → `buildScaleSwatch` (Phase 1).
4. `generateImage({ prompt: instruction, originalImages: [ {garment}, {swatch} ] })`.
5. Return `result.url`.

### 6.3 Fallback ladder (must degrade with NO regression)
1. vision bbox missing / low confidence → center-crop default bbox.
2. `sharp` throws / swatch build fails → **fall back to `generateEditedImage`**
   (current single-image path). Log and continue; never fail the job for this.
3. (Validated in Phase 0; if model ignores image 2, this whole pipeline should be
   feature-flagged off — see §9.)

### Phase 2 acceptance
- Unit-test `locateFabricPatch` with a mocked `invokeLLM` (happy path, malformed
  JSON → `null`, low confidence path).
- Unit-test the fallback selection logic with `sharp`/vision mocked so each rung
  is exercised without network.

---

## 7. Phase 3 — wire-up + prompt (~1 day)

### 7.1 `shared/controls.ts`
- Add a reference-style scale instruction. When scale is active, the prompt must
  reference "image 2 / the swatch" as the scale target and **must not** contain
  the "return the image unchanged" escape hatch (`controls.ts:237`) nor the full
  pixel-lock `TEXTILE_PREAMBLE` (`controls.ts:91`). Keep the garment-freeze intent
  ("same shape, pose, drape, lighting, background") but drop "pixel-aligned" /
  "return unchanged."
- Keep the existing scale-**up** behavior working (the same swatch approach works
  with `remainingScalePct > 100`; for enlarge, the tile is *bigger* than the
  patch — verify `buildScaleSwatch` handles factor > 1 or branch accordingly).
- **Back-compat:** existing tests in `server/studio.test.ts` assert the old scale
  strings (`"SHRINK THE MOTIF REPEAT"`, `"130%"`, etc.). Update those tests in the
  same commit to match the new prompt; do not leave them red.

### 7.2 `server/routers/studio.ts`
- In `generate` (`:96`) and `rerun` (`:375`), when `controls.scale.enabled &&
  controls.scale.percent !== 0`, call `generateScaledImage(...)` with
  `remainingScalePct = 100 - Math.abs(percent)`; otherwise keep
  `generateEditedImage` (`:200`, `:414`).
- **Combined controls:** if scale is combined with remove/recolor/density, scale
  must run as its own pass first (swatch-guided), then the appearance edits, OR
  document that combined-with-scale falls back to single-pass for v1. Pick the
  simpler (single extra pass for scale only) and note the decision in the PR.
- Credits, refunds, variations, and job-status logic stay unchanged.

### 7.3 Manual validation
Run against ≥3 real garment photos (flat-lay + hanging + on-body if available) at
−50%, −20%, and +30%. Capture before/after in the PR. Acceptance = motif scale
change is **obvious to the eye** while garment pose/background are preserved.

---

## 8. If Phase 0 fails (image-2 ignored)

Do **not** proceed. Report with the spike evidence. The only reliable alternative
needs a real **fabric segmentation mask** to composite a scaled pattern directly
onto the fabric region and AI-infill the seams. Forge exposes no segmentation
model and the vision LLM cannot produce masks, so this requires sourcing an
external segmentation model — a separate scoping decision for the human team, not
something to start unprompted.

---

## 9. Rollout & safety

- Gate the new path behind a simple flag (env var or a constant) so it can be
  switched off instantly back to `generateEditedImage` if quality regresses.
- Every rung of the fallback ladder must log clearly (`[aiEngine] ...` style,
  matching existing logs) and never break a job that the old path would complete.
- No change to credit cost, timeouts (`fetchTimeout.ts`), size limits
  (`MAX_IMAGE_SIZE_BYTES`, `aiEngine.ts:17`), or storage keys.

## 10. Effort

| Phase | Scope | Est. |
|------|-------|------|
| 0 | sharp + image-2 spike (**gate**) | ~1 day |
| 1 | `imagePatch.ts` + unit tests | ~2–3 days |
| 2 | vision bbox + orchestrator + fallback tests | ~2 days |
| 3 | prompt + router wire-up + manual validation | ~1 day |

**~6–7 days total**, but Phase 0 is the real decision point.

## 11. Honest caveats

- The reference-guided design **depends on an unverified Forge model behavior**
  (Phase 0). It cannot be confirmed without live API keys and visual inspection.
- A flat tiled swatch does not follow folds; it communicates **scale**, not final
  pixels — the model handles re-draping. If realism on heavily draped fabric is
  insufficient, that is a model-quality ceiling, not a bug in this pipeline.
