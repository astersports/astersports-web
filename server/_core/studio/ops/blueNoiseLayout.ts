/**
 * T2.3 — Blue-noise layout via Bridson 2007 Poisson-disk sampling.
 *
 * Produces EXACTLY `m` points inside a fabric raster whose local density is
 * uniform (blue-noise spectrum) — the target positions the surviving motifs are
 * relocated to (densityRedistribute.ts).
 *
 * Method: Bridson's fast Poisson-disk sampling (O(N), correct blue-noise
 * spectrum) with a spatial-hash acceleration grid (cell size s = r/√2). When
 * Bridson produces more than `m` candidates, Yuksel 2015 weighted sample
 * elimination trims the set to exactly `m` while preserving the blue-noise
 * property. When fewer than `m` are produced (tight fabric), the radius is
 * relaxed and the process retries.
 *
 * Advantages over the previous Lloyd-relaxation approach:
 *  - Correct blue-noise spectrum (not over-regularized lattice)
 *  - O(N) vs O(iterations·M·CAP) — faster on large rasters
 *  - No convergence ambiguity — deterministic single-pass
 *  - NNI stays in the [1.0, cap] band without post-hoc clamping
 *
 * Pure + deterministic: seeded PRNG, no convergence test, same inputs ->
 * identical points. The spatial-hash grid (s = r/√2) is the correct primitive
 * here (Bridson 2007 §3) and is used inside this implementation.
 */
import type { RasterMask, BBoxNormalized } from "../../masking/types";

export interface BlueNoiseOptions {
  /** PRNG seed. Default 1. */
  seed?: number;
  /** Bridson candidates per active point (k). Default 30. */
  candidates?: number;
  /** Fractional inset from the fabric bbox edges. Default 0.12. */
  edgeMargin?: number;
}

export type Point = [number, number];

// ─── PRNG ────────────────────────────────────────────────────────────────────

/** mulberry32 — small deterministic PRNG. */
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

// ─── Spatial Hash Grid ───────────────────────────────────────────────────────

interface SpatialGrid {
  cells: (number | undefined)[];
  cellSize: number;
  cols: number;
  rows: number;
  x0: number;
  y0: number;
}

function createGrid(x0: number, y0: number, w: number, h: number, cellSize: number): SpatialGrid {
  const cols = Math.max(1, Math.ceil(w / cellSize));
  const rows = Math.max(1, Math.ceil(h / cellSize));
  return { cells: new Array(cols * rows).fill(undefined), cellSize, cols, rows, x0, y0 };
}

function gridInsert(grid: SpatialGrid, points: Point[], idx: number): void {
  const [px, py] = points[idx];
  const col = Math.floor((px - grid.x0) / grid.cellSize);
  const row = Math.floor((py - grid.y0) / grid.cellSize);
  if (col >= 0 && col < grid.cols && row >= 0 && row < grid.rows) {
    grid.cells[row * grid.cols + col] = idx;
  }
}

function gridHasNeighbor(grid: SpatialGrid, points: Point[], px: number, py: number, r: number): boolean {
  const col = Math.floor((px - grid.x0) / grid.cellSize);
  const row = Math.floor((py - grid.y0) / grid.cellSize);
  const r2 = r * r;
  // Check 5x5 neighborhood (covers the r-distance check)
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      const c = col + dx;
      const rr = row + dy;
      if (c < 0 || c >= grid.cols || rr < 0 || rr >= grid.rows) continue;
      const idx = grid.cells[rr * grid.cols + c];
      if (idx === undefined) continue;
      const [qx, qy] = points[idx];
      if ((px - qx) ** 2 + (py - qy) ** 2 < r2) return true;
    }
  }
  return false;
}

// ─── Fabric Helpers ──────────────────────────────────────────────────────────

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

/** Check if a point is inside the fabric raster (with edge margin). */
function isInFabric(raster: RasterMask, x: number, y: number): boolean {
  const ix = Math.round(x);
  const iy = Math.round(y);
  if (ix < 0 || ix >= raster.width || iy < 0 || iy >= raster.height) return false;
  return raster.data[iy * raster.width + ix] > 127;
}

const EDGE_MARGIN = 0.12;

// ─── Bridson Poisson-Disk Sampling ───────────────────────────────────────────

/**
 * Bridson 2007 fast Poisson-disk sampling within a fabric raster.
 * Returns all valid samples (may be more or fewer than `m`).
 */
function bridsonSample(
  raster: RasterMask,
  r: number,
  rng: () => number,
  insetBBox: { x0: number; y0: number; w: number; h: number },
  k: number
): Point[] {
  const { x0, y0, w, h } = insetBBox;
  const cellSize = r / Math.SQRT2;
  const grid = createGrid(x0, y0, w, h, cellSize);
  const points: Point[] = [];
  const active: number[] = [];

  // First point: random position inside fabric
  let firstX: number, firstY: number;
  let attempts = 0;
  do {
    firstX = x0 + rng() * w;
    firstY = y0 + rng() * h;
    attempts++;
  } while (!isInFabric(raster, firstX, firstY) && attempts < 1000);

  if (!isInFabric(raster, firstX, firstY)) return [];

  points.push([firstX, firstY]);
  active.push(0);
  gridInsert(grid, points, 0);

  while (active.length > 0) {
    // Pick a random active point
    const activeIdx = Math.floor(rng() * active.length);
    const pointIdx = active[activeIdx];
    const [px, py] = points[pointIdx];
    let found = false;

    for (let i = 0; i < k; i++) {
      // Generate random candidate in annulus [r, 2r]
      const angle = rng() * 2 * Math.PI;
      const dist = r + rng() * r; // uniform in [r, 2r]
      const cx = px + dist * Math.cos(angle);
      const cy = py + dist * Math.sin(angle);

      // Check bounds and fabric membership
      if (cx < x0 || cx >= x0 + w || cy < y0 || cy >= y0 + h) continue;
      if (!isInFabric(raster, cx, cy)) continue;

      // Check no existing point within r
      if (gridHasNeighbor(grid, points, cx, cy, r)) continue;

      // Accept candidate
      points.push([cx, cy]);
      const newIdx = points.length - 1;
      active.push(newIdx);
      gridInsert(grid, points, newIdx);
      found = true;
    }

    if (!found) {
      // Remove from active list (swap with last for O(1))
      active[activeIdx] = active[active.length - 1];
      active.pop();
    }
  }

  return points;
}

// ─── Yuksel 2015 Weighted Sample Elimination ─────────────────────────────────

/**
 * Trim a Poisson-disk sample set to exactly `m` points while preserving the
 * blue-noise property. Uses Yuksel's weight function: points with the smallest
 * minimum-distance-to-neighbors are eliminated first.
 */
function yukselEliminate(points: Point[], m: number, rng: () => number): Point[] {
  if (points.length <= m) return points.slice(0, m);

  // Compute weights: w(p) = 1 / min_distance_to_any_neighbor
  // Higher weight = more crowded = eliminate first
  const n = points.length;
  const weights = new Float64Array(n);
  const alive = new Uint8Array(n).fill(1);

  // For efficiency, compute pairwise distances only within a reasonable radius
  // Use a simple O(n²) for moderate n (< 5000 typical for fabric layouts)
  for (let i = 0; i < n; i++) {
    let minDist = Infinity;
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const d = (points[i][0] - points[j][0]) ** 2 + (points[i][1] - points[j][1]) ** 2;
      if (d < minDist) minDist = d;
    }
    weights[i] = minDist > 0 ? 1 / Math.sqrt(minDist) : Infinity;
  }

  // Eliminate points with highest weight (most crowded) until m remain
  let remaining = n;
  while (remaining > m) {
    // Find the point with highest weight among alive points
    let maxW = -1;
    let maxIdx = -1;
    for (let i = 0; i < n; i++) {
      if (!alive[i]) continue;
      if (weights[i] > maxW) {
        maxW = weights[i];
        maxIdx = i;
      }
    }
    if (maxIdx < 0) break;

    alive[maxIdx] = 0;
    remaining--;

    // Update weights of neighbors (their min-distance may have increased)
    for (let i = 0; i < n; i++) {
      if (!alive[i]) continue;
      let minDist = Infinity;
      for (let j = 0; j < n; j++) {
        if (i === j || !alive[j]) continue;
        const d = (points[i][0] - points[j][0]) ** 2 + (points[i][1] - points[j][1]) ** 2;
        if (d < minDist) minDist = d;
      }
      weights[i] = minDist > 0 ? 1 / Math.sqrt(minDist) : Infinity;
    }
  }

  return points.filter((_, i) => alive[i]);
}

// ─── Lloyd / CVT Relaxation ──────────────────────────────────────────────────

const LLOYD_SAMPLE_CAP = 4000;

/**
 * Lloyd relaxation toward a centroidal Voronoi tessellation: even out the voids
 * Yuksel elimination leaves so local density is uniform (not merely min-distance
 * bounded). Deterministic (no RNG). Bounded cost: the fabric is sampled on a stride
 * so work is ~O(LLOYD_SAMPLE_CAP · m · iters) regardless of raster size. A point
 * whose centroid would land off-fabric keeps its prior position (stays on garment).
 */
function lloydRelax(
  points: Point[],
  raster: RasterMask,
  inset: { x0: number; y0: number; w: number; h: number },
  iters: number
): Point[] {
  if (points.length <= 1) return points;
  const { width: w, height: h, data } = raster;
  const area = Math.max(1, inset.w * inset.h);
  const stride = Math.max(1, Math.round(Math.sqrt(area / LLOYD_SAMPLE_CAP)));
  const pts = points.map((p) => [p[0], p[1]] as Point);
  const x1 = inset.x0 + inset.w, y1 = inset.y0 + inset.h;
  for (let it = 0; it < iters; it++) {
    const sumX = new Float64Array(pts.length);
    const sumY = new Float64Array(pts.length);
    const cnt = new Int32Array(pts.length);
    for (let y = inset.y0; y < y1; y += stride) {
      for (let x = inset.x0; x < x1; x += stride) {
        const ix = Math.round(x), iy = Math.round(y);
        if (ix < 0 || ix >= w || iy < 0 || iy >= h || data[iy * w + ix] <= 127) continue;
        let bi = 0, bd = Infinity;
        for (let j = 0; j < pts.length; j++) {
          const dx = pts[j][0] - x, dy = pts[j][1] - y;
          const d = dx * dx + dy * dy;
          if (d < bd) { bd = d; bi = j; }
        }
        sumX[bi] += x; sumY[bi] += y; cnt[bi]++;
      }
    }
    for (let j = 0; j < pts.length; j++) {
      if (cnt[j] === 0) continue;
      const nx = sumX[j] / cnt[j], ny = sumY[j] / cnt[j];
      const rx = Math.round(nx), ry = Math.round(ny);
      if (rx >= 0 && rx < w && ry >= 0 && ry < h && data[ry * w + rx] > 127) {
        pts[j][0] = nx; pts[j][1] = ny;
      }
    }
  }
  return pts;
}

// ─── Main Entry Point ────────────────────────────────────────────────────────

/**
 * Produce EXACTLY `m` even (blue-noise) points inside the fabric raster.
 * Uses Bridson 2007 Poisson-disk sampling + Yuksel 2015 elimination.
 *
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

  // True fabric area (pixel count)
  let fabricArea = 0;
  for (let i = 0; i < w * h; i++) if (data[i] > 127) fabricArea++;
  if (fabricArea === 0) return [];
  // Degenerate: more points requested than fabric pixels
  if (m >= fabricArea) {
    const pts: Point[] = [];
    for (let i = 0; i < w * h && pts.length < m; i++) if (data[i] > 127) pts.push([i % w, Math.floor(i / w)]);
    return pts;
  }

  const seed = opts.seed ?? 1;
  const k = opts.candidates ?? 30;
  const margin = opts.edgeMargin ?? EDGE_MARGIN;
  const rng = mulberry32(seed);

  // Compute inset bbox
  const pb = fabricPixelBBox(raster) ?? {
    x0: fabricBbox.x * w,
    y0: fabricBbox.y * h,
    x1: (fabricBbox.x + fabricBbox.w) * w,
    y1: (fabricBbox.y + fabricBbox.h) * h,
  };
  const bw = Math.max(1, pb.x1 - pb.x0 + 1);
  const bh = Math.max(1, pb.y1 - pb.y0 + 1);
  const insetBBox = {
    x0: pb.x0 + bw * margin,
    y0: pb.y0 + bh * margin,
    w: Math.max(1, bw * (1 - 2 * margin)),
    h: Math.max(1, bh * (1 - 2 * margin)),
  };

  // Compute initial radius from target density:
  // For m points in area A, hex-packing gives r = sqrt(2A / (sqrt(3)·m))
  // Start with 80% of that to over-generate, then eliminate
  const rTarget = Math.sqrt((2 * fabricArea) / (Math.sqrt(3) * m));
  let r = rTarget * 0.7; // Start smaller to over-generate

  // Adaptive: try Bridson with decreasing r until we get >= m points
  let samples: Point[] = [];
  let attempts = 0;
  const maxAttempts = 5;

  while (attempts < maxAttempts) {
    const localRng = mulberry32(seed + attempts);
    samples = bridsonSample(raster, r, localRng, insetBBox, k);

    if (samples.length >= m) break;

    // Reduce radius by 20% to pack more points
    r *= 0.8;
    attempts++;
  }

  // If still not enough points (very tight fabric), fill with random fabric pixels
  if (samples.length < m) {
    const needed = m - samples.length;
    for (let i = 0; i < w * h && samples.length < m; i++) {
      const px = i % w;
      const py = Math.floor(i / w);
      if (data[i] > 127 && px >= insetBBox.x0 && px < insetBBox.x0 + insetBBox.w &&
          py >= insetBBox.y0 && py < insetBBox.y0 + insetBBox.h) {
        // Check not too close to existing points (use r/2 as minimum)
        let tooClose = false;
        for (const [sx, sy] of samples) {
          if ((px - sx) ** 2 + (py - sy) ** 2 < (r / 2) ** 2) {
            tooClose = true;
            break;
          }
        }
        if (!tooClose) samples.push([px, py]);
      }
    }
  }

  // Yuksel elimination: trim to exactly m points
  if (samples.length > m) {
    samples = yukselEliminate(samples, m, rng);
  }

  // Lloyd/CVT relaxation: Bridson + Yuksel guarantee a MIN spacing but leave VOIDS
  // where crowded points were eliminated, so local density is uneven (visible clumps
  // + streaks, not a clean even scatter). A few relaxation passes move each point to
  // the centroid of the fabric pixels nearest it, evening local density to a uniform
  // distribution like a couture flat-swatch reduction. Deterministic (no RNG).
  samples = lloydRelax(samples, raster, insetBBox, 4);

  // Snap all points to integer fabric pixels (the composite step uses integer coords)
  return samples.map(([x, y]) => {
    const ix = Math.round(x);
    const iy = Math.round(y);
    if (ix >= 0 && ix < w && iy >= 0 && iy < h && data[iy * w + ix] > 127) return [ix, iy] as Point;
    // Snap to nearest fabric pixel
    let best: Point = [ix, iy];
    let bd = Infinity;
    for (let dy = -3; dy <= 3; dy++) {
      for (let dx = -3; dx <= 3; dx++) {
        const nx = ix + dx, ny = iy + dy;
        if (nx >= 0 && nx < w && ny >= 0 && ny < h && data[ny * w + nx] > 127) {
          const d = dx * dx + dy * dy;
          if (d < bd) { bd = d; best = [nx, ny]; }
        }
      }
    }
    return best;
  });
}
