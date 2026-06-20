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

  // Tight pixel bbox of the fabric region.
  let xmin = width, xmax = -1, ymin = height, ymax = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (raster.data[y * width + x] > 127) {
        if (x < xmin) xmin = x; if (x > xmax) xmax = x; if (y < ymin) ymin = y; if (y > ymax) ymax = y;
      }
    }
  }
  if (xmax < 0) return { data: buffer, width, height, changed: false }; // empty mask -> passthrough
  const bw = xmax - xmin + 1, bh = ymax - ymin + 1;
  const f = input.targetFraction;

  const patch = await sharp(buffer, { raw: { width, height, channels: 4 } })
    .extract({ left: xmin, top: ymin, width: bw, height: bh })
    .png()
    .toBuffer();

  // Resample + refill the bbox.
  let filled: Buffer;
  if (f === 1) {
    filled = patch;
  } else {
    const rw = Math.max(1, Math.round(bw * f)), rh = Math.max(1, Math.round(bh * f));
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
  // f===1 is a near-passthrough (the composite still runs but pixels are identical).
  // Signal changed:false so the caller's no-op guard can refund.
  return { data: out, width, height, changed: f !== 1 };
}
