/**
 * Deterministic k-means++ for extracting a print's color separations (A1).
 *
 * Hand-rolled with a fixed-seed RNG so centroids are byte-for-byte reproducible
 * across runs/versions — a hard requirement of the A1 acceptance gate. No
 * dependency (ml-kmeans's determinism is RNG/version-sensitive).
 */
export type Vec3 = [number, number, number];

export interface KMeansResult {
  centroids: Vec3[];
  assignments: Int32Array;
}

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

const dist2 = (a: Vec3, b: Vec3): number => {
  const dl = a[0] - b[0];
  const da = a[1] - b[1];
  const db = a[2] - b[2];
  return dl * dl + da * da + db * db;
};

export function kmeans(
  points: Vec3[],
  k: number,
  opts: { seed?: number; maxIter?: number } = {}
): KMeansResult {
  const seed = opts.seed ?? 1;
  const maxIter = opts.maxIter ?? 50;
  const n = points.length;
  const K = Math.max(1, Math.min(k, n));
  const rng = mulberry32(seed);

  // k-means++ seeding.
  const centroids: Vec3[] = [];
  centroids.push([...points[Math.floor(rng() * n)]] as Vec3);
  const d2 = new Float64Array(n).fill(Infinity);
  for (let c = 1; c < K; c++) {
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const dd = dist2(points[i], centroids[c - 1]);
      if (dd < d2[i]) d2[i] = dd;
      sum += d2[i];
    }
    let r = rng() * sum;
    let idx = 0;
    for (let i = 0; i < n; i++) {
      r -= d2[i];
      if (r <= 0) { idx = i; break; }
      idx = i;
    }
    centroids.push([...points[idx]] as Vec3);
  }

  // Lloyd iterations.
  const assign = new Int32Array(n);
  for (let iter = 0; iter < maxIter; iter++) {
    let changed = false;
    for (let i = 0; i < n; i++) {
      let best = 0;
      let bd = Infinity;
      for (let c = 0; c < K; c++) {
        const dd = dist2(points[i], centroids[c]);
        if (dd < bd) { bd = dd; best = c; }
      }
      if (assign[i] !== best) { assign[i] = best; changed = true; }
    }

    const sums: Vec3[] = Array.from({ length: K }, () => [0, 0, 0] as Vec3);
    const counts = new Int32Array(K);
    for (let i = 0; i < n; i++) {
      const c = assign[i];
      sums[c][0] += points[i][0];
      sums[c][1] += points[i][1];
      sums[c][2] += points[i][2];
      counts[c]++;
    }
    for (let c = 0; c < K; c++) {
      if (counts[c] > 0) {
        centroids[c] = [sums[c][0] / counts[c], sums[c][1] / counts[c], sums[c][2] / counts[c]];
      }
    }

    if (!changed && iter > 0) break;
  }

  return { centroids, assignments: assign };
}
