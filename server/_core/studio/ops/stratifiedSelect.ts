/**
 * Deterministic stratified subset selection (R2). Returns indices of the removeN
 * instances to erase, spread evenly over a grid sized to the count. No RNG —
 * ties broken by instance index — so the result is byte-stable and densityMetrics'
 * evenness has a defined uniform-over-cells expectation to score against.
 */
import type { InstanceMask, BBoxNormalized } from "../../masking/types";

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

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

  const cents = instances.map((inst) => centroid(inst, width, height));
  const bx = fabricBbox.x * width, by = fabricBbox.y * height;
  const bw = Math.max(1e-6, fabricBbox.w * width), bh = Math.max(1e-6, fabricBbox.h * height);

  // Grid sized to removeN, near-square cells matching the fabric aspect.
  const aspect = bw / bh;
  const cols = Math.max(1, Math.round(Math.sqrt(removeN * aspect)));
  const rows = Math.max(1, Math.ceil(removeN / cols));
  const cellW = bw / cols, cellH = bh / rows;

  // Bucket instances per cell by centroid.
  const cells = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const gx = clamp(Math.floor((cents[i][0] - bx) / bw * cols), 0, cols - 1);
    const gy = clamp(Math.floor((cents[i][1] - by) / bh * rows), 0, rows - 1);
    const key = gy * cols + gx;
    (cells.get(key) ?? cells.set(key, []).get(key)!).push(i);
  }

  // Within each cell, order by distance to the cell centre; ties by index.
  for (const [key, list] of Array.from(cells.entries())) {
    const gx = key % cols, gy = Math.floor(key / cols);
    const ccx = bx + (gx + 0.5) * cellW, ccy = by + (gy + 0.5) * cellH;
    list.sort((a, b) => {
      const da = (cents[a][0] - ccx) ** 2 + (cents[a][1] - ccy) ** 2;
      const db = (cents[b][0] - ccx) ** 2 + (cents[b][1] - ccy) ** 2;
      return da - db || a - b;
    });
  }

  // Round-robin: one pick per cell per round (nearest first), row-major order.
  const order = Array.from(cells.keys()).sort((a, b) => a - b);
  const selected: number[] = [];
  for (let r = 0; selected.length < removeN; r++) {
    let progressed = false;
    for (const key of order) {
      const list = cells.get(key)!;
      if (r < list.length) {
        selected.push(list[r]);
        progressed = true;
        if (selected.length >= removeN) break;
      }
    }
    if (!progressed) break;
  }
  return selected;
}
