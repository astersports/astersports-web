/**
 * A1 — deterministic separation remap.
 *
 * Extracts the print's color separations (k-means in LAB), picks the separation
 * nearest the user's source color, and shifts that separation's chroma (a,b)
 * toward the target color while PRESERVING each pixel's own luminance (L) — so
 * weave, shading, highlights and texture survive (a dye-lot change, not a flat
 * overlay). Pure pixel math, no model call, fully deterministic.
 *
 * Binds to the merged mask seam (server/_core/masking) unchanged: uses
 * `fabric.raster` when present (raster-ready provider) else the normalized
 * `fabric.bbox`. Hard dependency on sharp (spike S3, verified).
 */
import sharp from "sharp";
import { decodeUpright } from "../../image/decodeUpright";
import type { FabricMask, MaskImageInput } from "../../masking";
import { rgb255ToLab, labToRgb255, hexToLab, deltaE2000 } from "./color";
import { kmeans, type Vec3 } from "./kmeans";
import { fabricMembership } from "./membership";

export interface SeparationRemapParams {
  /** User-picked source color to identify the separation to change (hex/CSS). */
  fromColor: string;
  /** Target color the separation is remapped toward (hex/CSS). */
  toColor: string;
  /** 10..100 — selection tolerance over color families (ΔE2000 from fromColor a
   *  centroid may sit and still be selected). Higher pulls in more nearby families. */
  coverage: number;
}

export interface SeparationRemapOptions {
  /** Number of separations to extract. Default 5. */
  k?: number;
  /** Fixed RNG seed for reproducible centroids. Default 1. */
  seed?: number;
  /** Cap on k-means sample size (perf). Default 20000. */
  maxSamples?: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export async function separationRemap(
  image: MaskImageInput,
  fabric: FabricMask,
  params: SeparationRemapParams,
  options: SeparationRemapOptions = {}
): Promise<Buffer> {
  const k = options.k ?? 5;
  const seed = options.seed ?? 1;
  const maxSamples = options.maxSamples ?? 20000;

  const { buffer, width, height } = await decodeUpright(image.url); // mutable RGBA copy
  const membership = fabricMembership(fabric, width, height);

  // Collect fabric pixel indices + their LAB.
  const idxs: number[] = [];
  for (let i = 0; i < width * height; i++) if (membership[i]) idxs.push(i);
  if (idxs.length === 0) {
    return sharp(buffer, { raw: { width, height, channels: 4 } }).png().toBuffer();
  }

  const labs: Vec3[] = new Array(idxs.length);
  for (let j = 0; j < idxs.length; j++) {
    const p = idxs[j] * 4;
    const lab = rgb255ToLab(buffer[p], buffer[p + 1], buffer[p + 2]);
    labs[j] = [lab.l, lab.a, lab.b];
  }

  // Extract separations on a strided sample for speed.
  const stride = Math.max(1, Math.floor(labs.length / maxSamples));
  const sample = stride > 1 ? labs.filter((_, j) => j % stride === 0) : labs;
  const { centroids } = kmeans(sample, k, { seed });

  // Pick the separation nearest the source color (CIEDE2000).
  const fromLab = hexToLab(params.fromColor);
  let targetIdx = 0;
  let best = Infinity;
  centroids.forEach((c, ci) => {
    const d = deltaE2000(fromLab, { l: c[0], a: c[1], b: c[2] });
    if (d < best) { best = d; targetIdx = ci; }
  });
  const toLab = hexToLab(params.toColor);

  // coverage 10..100 -> CLUSTER tolerance (LAB ΔE2000): how far a centroid may sit
  // from fromColor and still belong to the selected separation. NOT a per-pixel
  // radius — selection is by k-means cluster membership, so a distinct nearby
  // separation (e.g. red rims) is bounded out by its own Voronoi cell. Crank
  // coverage too high and adjacent color families come along — which is exactly
  // what the eval's offTargetFabricDeltaE is there to report, now visible.
  const tol = 5 + (clamp(params.coverage, 10, 100) / 100) * 40;
  const selected = new Set<number>([targetIdx]);
  centroids.forEach((c, ci) => {
    if (deltaE2000(fromLab, { l: c[0], a: c[1], b: c[2] }) <= tol) selected.add(ci);
  });

  const nearestCentroid = (lab: Vec3): number => {
    let bi = 0, bd = Infinity;
    for (let ci = 0; ci < centroids.length; ci++) {
      const c = centroids[ci];
      const dl = lab[0] - c[0], da = lab[1] - c[1], db = lab[2] - c[2];
      const d = dl * dl + da * da + db * db;
      if (d < bd) { bd = d; bi = ci; }
    }
    return bi;
  };

  // Binary selection mask over the full image: 255 where a fabric pixel's nearest
  // centroid is selected. Selected pixels get a FULL chroma remap (a,b -> target,
  // L preserved) = a true dye-lot change across the whole separation incl. tonal
  // spread. Unselected clusters are untouched.
  const selMask = Buffer.alloc(width * height);
  for (let j = 0; j < idxs.length; j++) {
    if (selected.has(nearestCentroid(labs[j]))) selMask[idxs[j]] = 255;
  }

  // Feather the selection ~1px in image space (thin and FIXED — not coverage-
  // scaled) so cluster boundaries blend instead of speckling. Deterministic blur.
  // sharp may emit >1 channel from a 1-channel raw input, so read with its stride.
  const { data: alpha, info: alphaInfo } = await sharp(selMask, {
    raw: { width, height, channels: 1 },
  })
    .blur(1)
    .raw()
    .toBuffer({ resolveWithObject: true });
  const aStride = alphaInfo.channels;

  // Blend remapped (a,b -> target) vs source by the feathered alpha, L held.
  // Only fabric pixels are written; background is never touched.
  for (let j = 0; j < idxs.length; j++) {
    const a = alpha[idxs[j] * aStride] / 255;
    if (a <= 0) continue;
    const lab = labs[j];
    const newA = lab[1] + (toLab.a - lab[1]) * a;
    const newB = lab[2] + (toLab.b - lab[2]) * a;
    const rgb = labToRgb255({ l: lab[0], a: newA, b: newB });
    const p = idxs[j] * 4;
    buffer[p] = rgb.r;
    buffer[p + 1] = rgb.g;
    buffer[p + 2] = rgb.b;
    // alpha (p+3) untouched
  }

  return sharp(buffer, { raw: { width, height, channels: 4 } }).png().toBuffer();
}
