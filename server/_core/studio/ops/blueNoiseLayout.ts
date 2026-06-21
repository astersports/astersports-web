/**
 * Even (blue-noise) point layout for Density v2 (Option B). Produces EXACTLY `m`
 * points inside a fabric raster whose local density is uniform — the target
 * positions the surviving motifs are relocated to (densityRedistribute.ts).
 *
 * Method: seeded jittered-grid initialisation, then a FIXED, SMALL number of
 * Lloyd / centroidal-Voronoi relaxation steps, terminated EARLY (NOT run to
 * convergence). This is the load-bearing guard from the literature: Lloyd
 * over-regularises into a rigid lattice and LOSES the blue-noise quality if run
 * to its local minimum, so the iteration count is capped (default ~10) rather
 * than convergence-tested (Ulichney 1987; Balzer et al. 2009 — see the spec §11).
 *
 * Spacing sanity target: densest-hex packing of m points in area A gives
 * r_max = sqrt(2A / (sqrt(3)·m)) ≈ 1.075·sqrt(A/m); the relative radius
 * eps ∈ [0,1] scales from "no constraint" to that densest packing
 * (Gamito & Maddock 2008). eps ≈ 0.75 keeps the layout even-but-organic, not
 * crystalline. r is used only to scale the initial jitter — Lloyd does the rest.
 *
 * Pure + deterministic: seeded PRNG, fixed iteration count, discrete Voronoi over
 * the raster's fabric pixels. Same inputs -> identical points.
 */
import type { RasterMask, BBoxNormalized } from "../../masking/types";

export interface BlueNoiseOptions {
  /** PRNG seed (matches the kmeans({seed}) convention). Default 1. */
  seed?: number;
  /** FIXED Lloyd iteration count — early stop, NOT convergence. Default 10. */
  iterations?: number;
  /** Relative radius eps ∈ [0,1] vs densest-hex packing. Default 0.75. */
  epsilon?: number;
  /** Fractional inset from the fabric bbox edges (reuses stratifiedSelect intent). Default 0.12. */
  edgeMargin?: number;
}

export type Point = [number, number];

/** mulberry32 — small deterministic PRNG (kept local; kmeans's copy is private). */
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return function () {
    s += 0x6d2b79f5;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Tight pixel bbox of the included (>127) raster pixels, or null if empty. */
function fabricPixelBBox(raster: RasterMask): { x0: number; y0: number; x1: number; y1: number } | null {
  const { width: w, height: h, data } = raster;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[y * w + x] > 127) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { x0, y0, x1, y1 };
}

const EDGE_MARGIN = 0.12; // default; see stratifiedSelect.ts for the same intent

/**
 * Produce EXACTLY `m` even (blue-noise) points inside the fabric raster.
 * `fabricBbox` is the normalized fabric bbox (used only to bound the inset);
 * the raster is the authority on which pixels are fabric.
 */
export function blueNoiseLayout(
  raster: RasterMask,
  fabricBbox: BBoxNormalized,
  m: number,
  opts: BlueNoiseOptions = {}
): Point[] {
  const { width: w, height: h, data } = raster;
  if (m <= 0) return [];

  // Fabric pixel index list — the discrete domain for Voronoi relaxation.
  const fabric: number[] = [];
  for (let i = 0; i < w * h; i++) if (data[i] > 127) fabric.push(i);
  if (fabric.length === 0) return [];
  // Degenerate: more points requested than fabric pixels — just hand back the first m.
  if (m >= fabric.length) {
    return fabric.slice(0, m).map((i) => [i % w, Math.floor(i / w)] as Point);
  }

  const seed = opts.seed ?? 1;
  const iterations = opts.iterations ?? 10;
  const eps = Math.max(0, Math.min(1, opts.epsilon ?? 0.75));
  const margin = opts.edgeMargin ?? EDGE_MARGIN;
  const rng = mulberry32(seed);

  // Inset bbox: prefer the raster's tight pixel bbox, fall back to the normalized
  // fabric bbox; inset by `margin` so seeds don't crowd the fabric boundary.
  const pb = fabricPixelBBox(raster) ?? {
    x0: fabricBbox.x * w,
    y0: fabricBbox.y * h,
    x1: (fabricBbox.x + fabricBbox.w) * w,
    y1: (fabricBbox.y + fabricBbox.h) * h,
  };
  const bw = Math.max(1, pb.x1 - pb.x0);
  const bh = Math.max(1, pb.y1 - pb.y0);
  const ix0 = pb.x0 + bw * margin;
  const iy0 = pb.y0 + bh * margin;
  const iw = Math.max(1, bw * (1 - 2 * margin));
  const ih = Math.max(1, bh * (1 - 2 * margin));

  // Densest-hex spacing target r; eps scales it. Used to bound the init jitter.
  const A = fabric.length;
  const r = eps * Math.sqrt((2 * A) / (Math.sqrt(3) * m));

  // Snap an arbitrary point to the nearest fabric pixel (keeps seeds in-region).
  const snap = (px: number, py: number): Point => {
    const xi = Math.round(px);
    const yi = Math.round(py);
    if (xi >= 0 && xi < w && yi >= 0 && yi < h && data[yi * w + xi] > 127) return [xi, yi];
    let best = fabric[0];
    let bd = Infinity;
    for (const fi of fabric) {
      const fx = fi % w;
      const fy = Math.floor(fi / w);
      const d = (fx - px) ** 2 + (fy - py) ** 2;
      if (d < bd) {
        bd = d;
        best = fi;
      }
    }
    return [best % w, Math.floor(best / w)];
  };

  // Seed: jittered grid over the inset bbox. cols·rows >= m; jitter bounded by r.
  const aspect = iw / ih;
  const cols = Math.max(1, Math.round(Math.sqrt(m * aspect)));
  const rows = Math.max(1, Math.ceil(m / cols));
  const cellW = iw / cols;
  const cellH = ih / rows;
  const jit = Math.min(0.5, r / Math.max(cellW, cellH, 1)); // fraction of a cell
  const seeds: Point[] = [];
  for (let gy = 0; gy < rows && seeds.length < m; gy++) {
    for (let gx = 0; gx < cols && seeds.length < m; gx++) {
      const cx = ix0 + (gx + 0.5) * cellW + (rng() - 0.5) * cellW * jit * 2;
      const cy = iy0 + (gy + 0.5) * cellH + (rng() - 0.5) * cellH * jit * 2;
      seeds.push(snap(cx, cy));
    }
  }

  // Lloyd / CVT relaxation — FIXED count, EARLY stop (no convergence test).
  const k = seeds.length;
  for (let iter = 0; iter < iterations; iter++) {
    const sumX = new Float64Array(k);
    const sumY = new Float64Array(k);
    const cnt = new Int32Array(k);
    for (const fi of fabric) {
      const fx = fi % w;
      const fy = Math.floor(fi / w);
      let best = 0;
      let bd = Infinity;
      for (let s = 0; s < k; s++) {
        const d = (fx - seeds[s][0]) ** 2 + (fy - seeds[s][1]) ** 2;
        if (d < bd) {
          bd = d;
          best = s;
        }
      }
      sumX[best] += fx;
      sumY[best] += fy;
      cnt[best]++;
    }
    for (let s = 0; s < k; s++) {
      if (cnt[s] === 0) continue; // empty cell — leave the seed where it is
      seeds[s] = snap(sumX[s] / cnt[s], sumY[s] / cnt[s]);
    }
  }

  return seeds;
}
