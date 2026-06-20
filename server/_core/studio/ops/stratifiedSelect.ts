/**
 * Deterministic stratified subset selection (R2). Returns indices of the removeN
 * instances to erase, chosen so that the REMOVALS are maximally spread across the
 * fabric interior — which guarantees the survivors are also evenly distributed
 * (no large gaps or clusters). No RNG — deterministic by farthest-point sampling
 * — so the result is byte-stable.
 *
 * Algorithm (farthest-point removal selection with edge penalty):
 *  1. Compute the centroid of each instance (raster mass-center or bbox center).
 *  2. Normalize centroids to the fabric bbox coordinate space [0,1]x[0,1].
 *  3. Compute an "interiority" weight for each instance: instances near the fabric
 *     edge get a reduced effective distance, making them less likely to be selected
 *     for removal (they're harder to fully infill at boundaries).
 *  4. Seed removal selection with the instance nearest the fabric center.
 *  5. Greedily pick removeN instances: iteratively select the instance whose
 *     weighted minimum distance to all already-selected REMOVALS is LARGEST.
 *  6. Return the selected indices as the removal set.
 *
 * By spreading removals evenly in the interior, the survivors fill the space
 * uniformly. Edge instances are preferentially kept as survivors since they're
 * harder to infill cleanly (fabric boundary clipping).
 *
 * Ties broken by instance index for determinism.
 * Complexity: O(removeN * n) which is fine for typical instance counts (<200).
 */
import type { InstanceMask, BBoxNormalized } from "../../masking/types";

function centroid(inst: InstanceMask, w: number, h: number): [number, number] {
  const r = inst.raster;
  if (r && r.width === w && r.height === h) {
    let sx = 0, sy = 0, n = 0;
    for (let i = 0; i < w * h; i++) if (r.data[i] > 127) { sx += i % w; sy += Math.floor(i / w); n++; }
    if (n > 0) return [sx / n, sy / n];
  }
  return [(inst.bbox.x + inst.bbox.w / 2) * w, (inst.bbox.y + inst.bbox.h / 2) * h];
}

export function stratifiedSelect(
  instances: InstanceMask[],
  removeN: number,
  fabricBbox: BBoxNormalized,
  width: number,
  height: number
): number[] {
  const n = instances.length;
  if (removeN <= 0) return [];
  if (removeN >= n) return Array.from({ length: n }, (_, i) => i);

  // Compute centroids normalized to fabric bbox space [0,1]x[0,1]
  const bx = fabricBbox.x * width, by = fabricBbox.y * height;
  const bw = Math.max(1e-6, fabricBbox.w * width), bh = Math.max(1e-6, fabricBbox.h * height);
  const cents = instances.map((inst) => {
    const [cx, cy] = centroid(inst, width, height);
    return [(cx - bx) / bw, (cy - by) / bh] as [number, number];
  });

  // Distance squared between two points
  const dist2 = (a: [number, number], b: [number, number]) =>
    (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;

  // Interiority weight: 1.0 for instances well inside the fabric, down to ~0.3
  // for instances at the very edge. This penalizes edge instances in the
  // farthest-point selection, making them less likely to be chosen for removal.
  const EDGE_MARGIN = 0.12; // normalized distance from edge that counts as "edge zone"
  const interiority = cents.map(([x, y]) => {
    const dx = Math.min(x, 1 - x); // distance to nearest vertical edge
    const dy = Math.min(y, 1 - y); // distance to nearest horizontal edge
    const minEdgeDist = Math.min(dx, dy);
    // Smooth ramp: 0.3 at edge → 1.0 at EDGE_MARGIN inside
    return minEdgeDist >= EDGE_MARGIN ? 1.0 : 0.3 + 0.7 * (minEdgeDist / EDGE_MARGIN);
  });

  // Seed: pick the instance nearest to the fabric center (0.5, 0.5) as the
  // first removal. Starting from center ensures removals radiate outward evenly.
  const center: [number, number] = [0.5, 0.5];
  let seedIdx = 0;
  let seedDist = Infinity;
  for (let i = 0; i < n; i++) {
    const d = dist2(cents[i], center);
    if (d < seedDist || (d === seedDist && i < seedIdx)) {
      seedDist = d;
      seedIdx = i;
    }
  }

  // Farthest-point sampling on the REMOVAL set with interiority weighting.
  const selected: number[] = [seedIdx];
  const minDist = new Float64Array(n).fill(Infinity);
  for (let i = 0; i < n; i++) {
    minDist[i] = dist2(cents[i], cents[seedIdx]);
  }
  minDist[seedIdx] = -1;

  while (selected.length < removeN) {
    let bestIdx = -1;
    let bestScore = -1;
    for (let i = 0; i < n; i++) {
      if (minDist[i] < 0) continue;
      // Weighted score: raw distance * interiority weight
      const score = minDist[i] * interiority[i];
      if (score > bestScore || (score === bestScore && i < bestIdx)) {
        bestScore = score;
        bestIdx = i;
      }
    }
    if (bestIdx < 0) break;

    selected.push(bestIdx);
    for (let i = 0; i < n; i++) {
      if (minDist[i] < 0) continue;
      const d = dist2(cents[i], cents[bestIdx]);
      if (d < minDist[i]) minDist[i] = d;
    }
    minDist[bestIdx] = -1;
  }

  return selected;
}
