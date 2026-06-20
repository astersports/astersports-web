/**
 * Base-cloth infill primitive (Phase B/C shared erase).
 *
 * Replaces a masked region with base cloth. Two modes:
 *  - default (L-preserve): each pixel's chroma (a,b) becomes the base-cloth
 *    anchor while its own luminance (L) is kept, so fold shadows survive and the
 *    erased area reads as bare cloth. Correct for ISO-LUMINANT occluders (recolor
 *    / scale tile boundaries) where the existing L already matches the cloth.
 *  - flatten=true: also replace L with baseClothLab.L (full base-cloth fill).
 *    Needed when erasing an OPAQUE motif whose L differs from the cloth (density /
 *    remove) — otherwise the motif's luminance survives as a ghost.
 * The erase primitive shared by scale, density, and remove.
 *
 * Pure + deterministic: no provider call, no model call, no randomness. Same
 * inputs -> identical bytes. `baseClothLab` is a CALLER input (not derived here)
 * because base-cloth sourcing is op-specific — density samples between survivors,
 * scale samples the freed gaps. The primitive stays pure; the op computes the
 * anchor. `baseClothLab.L` is used only when `flatten` is set.
 *
 * Returns RAW RGBA pixels so the consuming op can compose without re-decoding.
 */
import sharp from "sharp";
import { decodeUpright } from "../../image/decodeUpright";
import { rgb255ToLab, labToRgb255 } from "./color";
import type { MaskImageInput, RasterMask } from "../../masking/types";

export interface InfillInput {
  /** {url}; decoded upright via the seam helper (memoized per job upstream). */
  image: MaskImageInput;
  /** 255 = infill here, 0 = keep. Same dims as the decoded image. */
  region: RasterMask;
  /** Caller-supplied base-cloth anchor (a,b used; L per-pixel from the image). */
  baseClothLab: { L: number; a: number; b: number };
  /** Boundary feather in image-space px. Default 1. */
  featherPx?: number;
  /**
   * When true, also replace luminance with baseClothLab.L (full base-cloth fill).
   * Needed when erasing an OPAQUE motif whose L differs from the cloth (else the
   * motif's luminance survives as a ghost). Default false = preserve pixel L
   * (correct for iso-luminant occluders: recolor/scale boundaries).
   */
  flatten?: boolean;
}

export interface InfillResult {
  /** Edited raw RGBA, same dims, original alpha channel preserved. */
  data: Buffer;
  width: number;
  height: number;
}

export async function infillBaseCloth(input: InfillInput): Promise<InfillResult> {
  const { buffer, width, height } = await decodeUpright(input.image.url);

  if (input.region.width !== width || input.region.height !== height) {
    throw new Error(
      `infillBaseCloth: region dims ${input.region.width}x${input.region.height} ` +
        `!= image ${width}x${height}`
    );
  }

  const feather = input.featherPx ?? 1;
  const base = input.baseClothLab;

  // Binary selection from the region mask.
  const bin = Buffer.alloc(width * height);
  for (let i = 0; i < bin.length; i++) bin[i] = input.region.data[i] > 127 ? 255 : 0;

  // Feathered alpha. The blurred binary mask subsumes both the full interior fill
  // (alpha ~1) and the thin boundary blend; outside stays alpha 0. sharp emits a
  // multi-channel raw buffer from 1-channel input, so read at the reported stride.
  let alpha: Buffer | Uint8Array = bin;
  let aStride = 1;
  if (feather >= 0.3) {
    const { data, info } = await sharp(bin, { raw: { width, height, channels: 1 } })
      .blur(feather)
      .raw()
      .toBuffer({ resolveWithObject: true });
    alpha = data;
    aStride = info.channels;
  }

  // Blend chroma -> base cloth by alpha, luminance untouched. Pixels with alpha 0
  // are left byte-identical (never re-encoded).
  for (let i = 0; i < width * height; i++) {
    const a = alpha[i * aStride] / 255;
    if (a <= 0) continue;
    const p = i * 4;
    const lab = rgb255ToLab(buffer[p], buffer[p + 1], buffer[p + 2]);
    const targetL = input.flatten ? base.L : lab.l; // flatten replaces L too
    const newL = lab.l + (targetL - lab.l) * a;
    const newA = lab.a + (base.a - lab.a) * a;
    const newB = lab.b + (base.b - lab.b) * a;
    const rgb = labToRgb255({ l: newL, a: newA, b: newB });
    buffer[p] = rgb.r;
    buffer[p + 1] = rgb.g;
    buffer[p + 2] = rgb.b;
    // alpha channel (p + 3) preserved
  }

  return { data: buffer, width, height };
}
