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

export interface SeparationRemapParams {
  /** User-picked source color to identify the separation to change (hex/CSS). */
  fromColor: string;
  /** Target color the separation is remapped toward (hex/CSS). */
  toColor: string;
  /** 10..100 — soft-assignment radius in LAB (higher = more of the separation). */
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
const smoothstep = (w: number) => w * w * (3 - 2 * w);

/** Fabric pixel membership: raster when dims match, else the normalized bbox. */
function buildMembership(fabric: FabricMask, width: number, height: number): Uint8Array {
  const m = new Uint8Array(width * height);
  const r = fabric.raster;
  if (r && r.width === width && r.height === height) {
    for (let i = 0; i < m.length; i++) m[i] = r.data[i] > 127 ? 1 : 0;
    return m;
  }
  const x0 = clamp(Math.floor(fabric.bbox.x * width), 0, width);
  const y0 = clamp(Math.floor(fabric.bbox.y * height), 0, height);
  const x1 = clamp(Math.ceil((fabric.bbox.x + fabric.bbox.w) * width), 0, width);
  const y1 = clamp(Math.ceil((fabric.bbox.y + fabric.bbox.h) * height), 0, height);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) m[y * width + x] = 1;
  }
  return m;
}

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
  const membership = buildMembership(fabric, width, height);

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
  const target = centroids[targetIdx];
  const toLab = hexToLab(params.toColor);

  // coverage 10..100 -> soft-assignment radius (LAB euclidean units).
  const radius = 5 + (clamp(params.coverage, 10, 100) / 100) * 40;

  // Remap: shift a/b toward target, keep L. Soft falloff by distance to the
  // target centroid blends edges and avoids halos. Pixels in other separations
  // fall outside the radius (weight 0) and are untouched.
  for (let j = 0; j < idxs.length; j++) {
    const lab = labs[j];
    const dl = lab[0] - target[0];
    const da = lab[1] - target[1];
    const db = lab[2] - target[2];
    const dist = Math.sqrt(dl * dl + da * da + db * db);
    let w = 1 - dist / radius;
    if (w <= 0) continue;
    if (w > 1) w = 1;
    w = smoothstep(w);

    const newA = lab[1] + (toLab.a - lab[1]) * w;
    const newB = lab[2] + (toLab.b - lab[2]) * w;
    const rgb = labToRgb255({ l: lab[0], a: newA, b: newB });
    const p = idxs[j] * 4;
    buffer[p] = rgb.r;
    buffer[p + 1] = rgb.g;
    buffer[p + 2] = rgb.b;
    // alpha (p+3) untouched
  }

  return sharp(buffer, { raw: { width, height, channels: 4 } }).png().toBuffer();
}
