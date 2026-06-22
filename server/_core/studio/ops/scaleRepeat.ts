/**
 * Scale op v1 (Phase B, flat-lay). Changes the print REPEAT: resample the masked
 * print content by targetFraction, then refill the fabric bbox — shrink mirror-
 * tiles (smaller motifs, tighter spacing, more of them, filling the garment like a
 * mill reducing the roller); enlarge center-crops. Composited only inside the
 * fabric raster, garment frozen. Pure + deterministic (pinned lanczos3 kernel, no
 * RNG, no model). Consumed by the scaleEval runner and the scale-live route
 * (STUDIO_SCALE_LIVE, dark by default).
 *
 * Deferred (surfaced by eval PNGs, not attempted here): drape-follow displacement
 * warp (on-body/hanging), placed-graphic/non-repeating prints, tile-boundary
 * lighting-seam cleanup, generative relight.
 */
import sharp from "sharp";
import { decodeUpright } from "../../image/decodeUpright";
import type { MaskImageInput, FabricMask } from "../../masking/types";
import { mirrorTileToSize } from "./tile";
import { largestComponentBBox } from "./connectedComponents";

export interface ScaleInput {
  image: MaskImageInput;
  /** MUST carry .raster (rasterReady provider). */
  fabric: FabricMask;
  /** (100 + percent) / 100. 0.5 = shrink 50%, 1.3 = +30%. */
  targetFraction: number;
  /** Optional boundary-cleanup anchor only; not load-bearing for tiling. */
  baseClothLab?: { L: number; a: number; b: number };
}

export interface ScaleResult {
  data: Buffer; // raw RGBA, same dims, alpha preserved
  width: number;
  height: number;
  /** True if the op actually modified pixels. False on empty-mask passthrough or f===1. */
  changed: boolean;
}

export async function scalePrintRepeat(input: ScaleInput): Promise<ScaleResult> {
  const { buffer, width, height } = await decodeUpright(input.image.url);
  const raster = input.fabric.raster;
  if (!raster) {
    throw new Error(
      "scalePrintRepeat: fabric.raster required (rasterReady provider); a bbox-only mask cannot avoid scaling background"
    );
  }
  if (raster.width !== width || raster.height !== height) {
    throw new Error(`scalePrintRepeat: raster dims ${raster.width}x${raster.height} != image ${width}x${height}`);
  }

  // Largest-connected-component bbox of the fabric region. Denoises SAM2 specks
  // so a rogue disconnected pixel can't inflate bw/bh and skew the center-crop /
  // mirror-tile geometry. On a clean single-component mask this equals the prior
  // global min/max scan, so contiguous-fixture outputs are byte-unchanged.
  const bbox = largestComponentBBox(raster.data, width, height);
  if (!bbox) return { data: buffer, width, height, changed: false }; // empty mask -> passthrough
  const { xmin, ymin, xmax, ymax } = bbox;
  const bw = xmax - xmin + 1, bh = ymax - ymin + 1;
  const f = input.targetFraction;

  const patch = await sharp(buffer, { raw: { width, height, channels: 4 } })
    .extract({ left: xmin, top: ymin, width: bw, height: bh })
    .png()
    .toBuffer();

  // Resample + refill the bbox.
  let filled: Buffer;
  // EFFECT (not intent): true only if the resample dimensions actually differ
  // from the source bbox. A near-unity fraction on a small motif can round back
  // to the original size (e.g. round(64 * 1.001) === 64) — that is a no-op.
  let dimsChanged = false;
  if (f === 1) {
    filled = patch;
  } else {
    const rw = Math.max(1, Math.round(bw * f)), rh = Math.max(1, Math.round(bh * f));
    dimsChanged = rw !== bw || rh !== bh;
    const resized = await sharp(patch).resize(rw, rh, { kernel: "lanczos3" }).png().toBuffer();
    filled = f > 1
      ? await sharp(resized).extract({ left: Math.floor((rw - bw) / 2), top: Math.floor((rh - bh) / 2), width: bw, height: bh }).png().toBuffer()
      : await mirrorTileToSize(resized, rw, rh, bw, bh);
  }

  // Original with the bbox replaced by the refilled (scaled) print.
  const scaledFull = await sharp(buffer, { raw: { width, height, channels: 4 } })
    .composite([{ input: filled, left: xmin, top: ymin }])
    .raw()
    .toBuffer();

  // Channel-stride-aware ~1px feather of the fabric mask.
  const bin = Buffer.alloc(width * height);
  for (let i = 0; i < bin.length; i++) bin[i] = raster.data[i] > 127 ? 255 : 0;
  const { data: alpha, info } = await sharp(bin, { raw: { width, height, channels: 1 } })
    .blur(1)
    .raw()
    .toBuffer({ resolveWithObject: true });
  const aStride = info.channels;

  // Blend: inside mask -> scaled, outside -> original (byte-identical where a == 0).
  const out = Buffer.from(buffer);
  for (let i = 0; i < width * height; i++) {
    const a = alpha[i * aStride] / 255;
    if (a <= 0) continue;
    const p = i * 4;
    out[p] = Math.round(buffer[p] + (scaledFull[p] - buffer[p]) * a);
    out[p + 1] = Math.round(buffer[p + 1] + (scaledFull[p + 1] - buffer[p + 1]) * a);
    out[p + 2] = Math.round(buffer[p + 2] + (scaledFull[p + 2] - buffer[p + 2]) * a);
    // alpha channel (p + 3) preserved from the original copy
  }
  // Report EFFECT, not intent. `changed:false` when the requested fraction rounded
  // the bbox back to its original dimensions (or f===1) so the caller's no-op guard
  // refunds instead of billing for an unchanged print (CLAUDE.md §4).
  return { data: out, width, height, changed: dimsChanged };
}
