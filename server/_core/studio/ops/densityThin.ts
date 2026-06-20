/**
 * Density op v1 (Phase C). Removes X% of motif INSTANCES by count (R1), selected
 * by deterministic stratified subset selection over a grid (R2), erased entirely
 * through the infillBaseCloth primitive (no second eraser). Survivors fall outside
 * the removal region and stay byte-identical. Pure + deterministic (no RNG).
 * Eval-only, behind STUDIO_DETERMINISTIC_DENSITY, not router-wired.
 *
 * Selection (pinned, no RNG): grid sized to the removal count; assign each
 * instance to a cell by centroid; round-robin one pick per cell, taking the
 * as-yet-unselected instance nearest the cell centre, ties broken by instance
 * index. Deterministic by construction; gives densityMetrics' evenness a defined
 * uniform-over-cells expectation to score against.
 */
import { decodeUpright } from "../../image/decodeUpright";
import { rgb255ToLab } from "./color";
import { kmeans, type Vec3 } from "./kmeans";
import { infillBaseCloth, type InfillResult } from "./infill";
import type { MaskImageInput, FabricMask, InstanceMask, RasterMask } from "../../masking/types";

export interface DensityInput {
  image: MaskImageInput;
  instances: InstanceMask[];
  removalFraction: number; // X / 100
  fabric?: FabricMask; // optional — restricts base-cloth sampling to fabric
  baseClothLab?: { L: number; a: number; b: number }; // optional explicit anchor
}
export type DensityResult = InfillResult;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Square dilation by `rad` px so the full motif sits inside the infill feather core. */
function dilate(src: Uint8Array, w: number, h: number, rad: number): Uint8Array {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!src[y * w + x]) continue;
    for (let dy = -rad; dy <= rad; dy++) for (let dx = -rad; dx <= rad; dx++) {
      const X = x + dx, Y = y + dy;
      if (X >= 0 && X < w && Y >= 0 && Y < h) out[Y * w + X] = 1;
    }
  }
  return out;
}

/** Mark an instance's pixels into `mask` (raster if present, else filled bbox). */
function markInstance(mask: Uint8Array, inst: InstanceMask, w: number, h: number): void {
  const r = inst.raster;
  if (r && r.width === w && r.height === h) {
    for (let i = 0; i < w * h; i++) if (r.data[i] > 127) mask[i] = 1;
    return;
  }
  const x0 = clamp(Math.floor(inst.bbox.x * w), 0, w), y0 = clamp(Math.floor(inst.bbox.y * h), 0, h);
  const x1 = clamp(Math.ceil((inst.bbox.x + inst.bbox.w) * w), 0, w), y1 = clamp(Math.ceil((inst.bbox.y + inst.bbox.h) * h), 0, h);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) mask[y * w + x] = 1;
}

function instanceCentroid(inst: InstanceMask, w: number, h: number): [number, number] {
  const r = inst.raster;
  if (r && r.width === w && r.height === h) {
    let sx = 0, sy = 0, n = 0;
    for (let i = 0; i < w * h; i++) if (r.data[i] > 127) { sx += i % w; sy += Math.floor(i / w); n++; }
    if (n > 0) return [sx / n, sy / n];
  }
  return [(inst.bbox.x + inst.bbox.w / 2) * w, (inst.bbox.y + inst.bbox.h / 2) * h];
}

function dominantGround(buffer: Buffer, w: number, h: number, instances: InstanceMask[], fabric?: FabricMask): { L: number; a: number; b: number } {
  const inInstance = new Uint8Array(w * h);
  for (const inst of instances) markInstance(inInstance, inst, w, h);
  const fr = fabric?.raster;
  const pts: Vec3[] = [];
  for (let i = 0; i < w * h; i++) {
    if (inInstance[i]) continue;
    if (fr && fr.width === w && fr.height === h && fr.data[i] <= 127) continue;
    if (pts.length < 20000 || i % 3 === 0) {
      const l = rgb255ToLab(buffer[i * 4], buffer[i * 4 + 1], buffer[i * 4 + 2]);
      pts.push([l.l, l.a, l.b]);
    }
  }
  if (pts.length === 0) return { L: 0, a: 0, b: 0 };
  const { centroids, assignments } = kmeans(pts, 3, { seed: 1 });
  const counts = new Array(centroids.length).fill(0);
  for (let j = 0; j < assignments.length; j++) counts[assignments[j]]++;
  let bi = 0;
  for (let c = 1; c < counts.length; c++) if (counts[c] > counts[bi]) bi = c;
  return { L: centroids[bi][0], a: centroids[bi][1], b: centroids[bi][2] };
}

export async function thinDensity(input: DensityInput): Promise<DensityResult> {
  const { buffer, width, height } = await decodeUpright(input.image.url);
  const N = input.instances.length;
  const removeCount = Math.round(N * clamp(input.removalFraction, 0, 1));
  if (removeCount <= 0 || N === 0) return { data: buffer, width, height };

  const cents = input.instances.map((inst) => instanceCentroid(inst, width, height));

  // Grid over the fabric region (or the instances' extent), sized to the count.
  let x0 = width, y0 = height, x1 = 0, y1 = 0;
  for (const [cx, cy] of cents) { x0 = Math.min(x0, cx); y0 = Math.min(y0, cy); x1 = Math.max(x1, cx); y1 = Math.max(y1, cy); }
  const cols = Math.max(1, Math.round(Math.sqrt(removeCount)));
  const rows = Math.max(1, Math.round(removeCount / cols));
  const cw = (x1 - x0 + 1) / cols, ch = (y1 - y0 + 1) / rows;

  // Bucket instances per cell, each list sorted by distance to the cell centre then index.
  const cells = new Map<number, number[]>();
  for (let i = 0; i < N; i++) {
    const gx = clamp(Math.floor((cents[i][0] - x0) / cw), 0, cols - 1);
    const gy = clamp(Math.floor((cents[i][1] - y0) / ch), 0, rows - 1);
    const key = gy * cols + gx;
    (cells.get(key) ?? cells.set(key, []).get(key)!).push(i);
  }
  for (const [key, list] of Array.from(cells.entries())) {
    const gx = key % cols, gy = Math.floor(key / cols);
    const ccx = x0 + (gx + 0.5) * cw, ccy = y0 + (gy + 0.5) * ch;
    list.sort((a, b) => {
      const da = (cents[a][0] - ccx) ** 2 + (cents[a][1] - ccy) ** 2;
      const db = (cents[b][0] - ccx) ** 2 + (cents[b][1] - ccy) ** 2;
      return da - db || a - b;
    });
  }

  // Round-robin: one pick per cell per pass, nearest-first.
  const selected = new Set<number>();
  const order = Array.from(cells.keys()).sort((a, b) => a - b);
  for (let pass = 0; selected.size < removeCount; pass++) {
    let progressed = false;
    for (const key of order) {
      const list = cells.get(key)!;
      if (pass < list.length && !selected.has(list[pass])) {
        selected.add(list[pass]);
        progressed = true;
        if (selected.size >= removeCount) break;
      }
    }
    if (!progressed) break;
  }

  // Removal region = union of selected instances, dilated so the full motif lands
  // inside the infill feather core (feather transition falls in surrounding ground).
  const filled = new Uint8Array(width * height);
  Array.from(selected).forEach((i) => markInstance(filled, input.instances[i], width, height));
  const grown = dilate(filled, width, height, 2);
  const region: RasterMask = { width, height, data: new Uint8Array(width * height) };
  for (let i = 0; i < width * height; i++) region.data[i] = grown[i] ? 255 : 0;

  const baseClothLab = input.baseClothLab ?? dominantGround(buffer, width, height, input.instances, input.fabric);
  // flatten: erased motifs are opaque, so replace luminance too (no motif ghost).
  return infillBaseCloth({ image: input.image, region, baseClothLab, flatten: true });
}
