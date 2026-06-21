/**
 * Density op v1 (Phase C). Removes percent% of motif INSTANCES by count (R1),
 * selected by deterministic stratified subset selection (R2, stratifiedSelect.ts),
 * erased entirely through infillBaseCloth. Survivors fall outside the removal
 * region and stay byte-identical. Pure + deterministic. Eval-only, behind
 * STUDIO_DETERMINISTIC_DENSITY, not router-wired.
 *
 * DEVIATIONS from the locked spec's step 7/8, flagged for ruling (both additive +
 * reversible) — needed to satisfy the spec's OWN countError<=0.10 acceptance on
 * realistic (opaque, non-iso-luminant) motifs:
 *  - step 8: infill called with flatten:true (replace L too). Plain L-preserving
 *    erase leaves a luminance ghost on an opaque motif whose L != cloth L (e.g.
 *    pink on black) -> densityMetrics reads 0 removed. (Demonstrated.)
 *  - step 7: the removal region is dilated ~2px so the full motif sits inside the
 *    infill feather core; the 1px feather otherwise under-erases round motifs.
 */
import { decodeUpright } from "../../image/decodeUpright";
import { rgb255ToLab } from "./color";
import { kmeans, type Vec3 } from "./kmeans";
import { infillBaseCloth, type InfillResult } from "./infill";
import { stratifiedSelect } from "./stratifiedSelect";
import type { MaskImageInput, FabricMask, InstanceMask, RasterMask } from "../../masking/types";

export interface DensityInput {
  image: MaskImageInput;
  fabric: FabricMask; // MUST carry .raster; bounds the op + base-cloth sampling
  instances: InstanceMask[];
  percent: number; // 0..90 (DENSITY_MAX). X% of instances to remove.
}
export interface DensityResult extends InfillResult {
  removed: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

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

/** Square dilation by `rad` px (keeps the full motif inside the infill feather core). */
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

/** Dominant LAB cluster of the bare ground (in-fabric, not covered by any instance). */
function baseClothAnchor(buffer: Buffer, w: number, h: number, raster: RasterMask, instances: InstanceMask[]): { L: number; a: number; b: number } | null {
  const inAny = new Uint8Array(w * h);
  for (const inst of instances) markInstance(inAny, inst, w, h);
  const pts: Vec3[] = [];
  for (let i = 0; i < w * h; i++) {
    if (raster.data[i] <= 127 || inAny[i]) continue;
    if (pts.length < 20000 || i % 3 === 0) {
      const l = rgb255ToLab(buffer[i * 4], buffer[i * 4 + 1], buffer[i * 4 + 2]);
      pts.push([l.l, l.a, l.b]);
    }
  }
  if (pts.length === 0) return null;
  const { centroids, assignments } = kmeans(pts, 3, { seed: 1 });
  const counts = new Array(centroids.length).fill(0);
  for (let j = 0; j < assignments.length; j++) counts[assignments[j]]++;
  let bi = 0;
  for (let c = 1; c < counts.length; c++) if (counts[c] > counts[bi]) bi = c;
  return { L: centroids[bi][0], a: centroids[bi][1], b: centroids[bi][2] };
}

export async function densityThin(input: DensityInput): Promise<DensityResult> {
  const { buffer, width, height } = await decodeUpright(input.image.url);
  const raster = input.fabric.raster;
  if (!raster) throw new Error("densityThin: fabric.raster required (rasterReady provider) to bound the op and sample base cloth");
  if (raster.width !== width || raster.height !== height) throw new Error(`densityThin: raster dims ${raster.width}x${raster.height} != image ${width}x${height}`);

  const n = input.instances.length;
  if (n === 0 || input.percent <= 0) return { data: buffer, width, height, removed: 0 };
  const removeN = clamp(Math.round((n * input.percent) / 100), 0, n);
  if (removeN === 0) return { data: buffer, width, height, removed: 0 };

  // F3: instance rasters MUST match image dims. If any drift, markInstance would
  // fall back to filling the entire bbox rectangle — a gross over-erase on a paid
  // op. Treat dim drift as a DEGRADE/no-op (consistent with the F1/F2 guards
  // below): return removed:0 so the caller's no-op guard fails + refunds instead
  // of billing for a bbox-painted result. Per-instance raster normalization is a
  // provider-side follow-up after the credentialed run. Returning here (before
  // baseClothAnchor and the removal-region build, both of which call markInstance)
  // guarantees no bbox fill ever runs.
  const dimDrift = input.instances.filter(
    (m) => !m.raster || m.raster.width !== width || m.raster.height !== height
  ).length;
  if (dimDrift > 0) {
    console.warn(`[density] ${dimDrift}/${input.instances.length} instance rasters not at ${width}x${height}; degrade -> refund (no bbox over-erase).`);
    return { data: buffer, width, height, removed: 0 };
  }

  const selected = stratifiedSelect(input.instances, removeN, input.fabric.bbox, width, height);
  const baseClothLab = baseClothAnchor(buffer, width, height, raster, input.instances);
  // F2: no bare-ground pixels to sample (fully-covered fabric / empty raster).
  // Refuse to smear black — signal a no-op so the caller refunds.
  if (!baseClothLab) {
    console.warn("[density] no bare-ground pixels to sample base cloth; no-op -> refund");
    return { data: buffer, width, height, removed: 0 };
  }

  // Removal region = selected instances, dilated, clipped to the fabric raster
  // AND to NOT any non-selected instance — so the dilation can never erase a
  // survivor that sits within ~2px of a removed motif (survivor-clip).
  const sel = new Uint8Array(width * height);
  for (const idx of selected) markInstance(sel, input.instances[idx], width, height);
  const grown = dilate(sel, width, height, 2);
  const survivors = new Uint8Array(width * height);
  const selectedSet = new Set(selected);
  for (let i = 0; i < input.instances.length; i++) {
    if (!selectedSet.has(i)) markInstance(survivors, input.instances[i], width, height);
  }
  const region: RasterMask = { width, height, data: new Uint8Array(width * height) };
  let regionCount = 0;
  for (let i = 0; i < width * height; i++) {
    const on = grown[i] && raster.data[i] > 127 && !survivors[i];
    region.data[i] = on ? 255 : 0;
    if (on) regionCount++;
  }
  // F1: removed must reflect EFFECT. If the selected instances clip to an empty
  // region (degenerate/empty fabric raster, or fully overlapped by survivors),
  // nothing is erased — report removed:0 so the caller's no-op guard refunds
  // instead of billing for a byte-identical image.
  if (regionCount === 0) return { data: buffer, width, height, removed: 0 };

  const erased = await infillBaseCloth({ image: input.image, region, baseClothLab, featherPx: 1, flatten: true });

  // The infill feather can graze survivor-motif pixels at a shared boundary;
  // restore them to the original so survivors stay byte-identical (the feather is
  // for clean edges against GROUND, not against survivors).
  const out = erased.data;
  for (let i = 0; i < width * height; i++) {
    if (!survivors[i]) continue;
    const p = i * 4;
    out[p] = buffer[p]; out[p + 1] = buffer[p + 1]; out[p + 2] = buffer[p + 2];
  }
  return { data: out, width, height, removed: selected.length };
}
