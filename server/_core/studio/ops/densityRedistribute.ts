/**
 * Density op v2 — Proportional Redistribution (Option B). Removes percent% of
 * motif INSTANCES by count, then RELOCATES the survivors to an even (blue-noise)
 * layout so local density is uniform — target areal density rho' = (1−p)·rho, no
 * holes, no clusters. New invariant vs v1: SAME motif identity + SAME scale, NEW
 * position (v1's byte-identical-survivor invariant is abandoned).
 *
 * This is a NEW op beside densityThin (v1, erase-only), reusing its primitives.
 * Render is a DETERMINISTIC COMPOSITE — no model call, no randomness:
 *   1. erase ALL N originals to base cloth (the exact v1 infill erase), then
 *   2. composite the M survivor crops at their assigned blue-noise targets
 *      (no resize -> scale preserved; no rotate -> orientation preserved).
 * Pure + deterministic: same inputs -> identical bytes.
 *
 * Default off behind ENV.studioDensityRedistribute. When on, studioEngine.runVariation
 * selects this op (over the v1 erase-only densityThin) on the LIVE density money path.
 * The flag flip itself stays Frank's (CLAUDE.md §1 human-on-flip).
 */
import sharp from "sharp";
import { decodeUpright } from "../../image/decodeUpright";
import { rgb255ToLab } from "./color";
import { kmeans, type Vec3 } from "./kmeans";
import { infillBaseCloth, type InfillResult } from "./infill";
import { blueNoiseLayout, type Point } from "./blueNoiseLayout";
import { assignTargets, type Assignment } from "./assignTargets";
import type { MaskImageInput, FabricMask, InstanceMask, RasterMask } from "../../masking/types";

export interface RedistributeInput {
  image: MaskImageInput;
  fabric: FabricMask; // MUST carry .raster; bounds the op + base-cloth sampling
  instances: InstanceMask[];
  percent: number; // 0..90. X% of instances to remove before redistributing.
  /** Blue-noise relaxation seed (matches kmeans({seed})). Default 1. */
  seed?: number;
}

export interface RedistributeResult extends InfillResult {
  /** Motifs present in the output: M (relocated survivors) on the active path, or
   *  all N on a no-op/passthrough. Invariant: removed + kept === instances.length. */
  kept: number;
  /** Removed motif count = N − kept (0 on a no-op/passthrough). Drives the
   *  count-based refund contract (§4.5): removed === 0 -> FAIL+REFUND. */
  removed: number;
  /** Even target positions the survivors were relocated to. */
  targets: Point[];
  /** Matched source-instance -> target index. length === kept. */
  assignments: Assignment[];
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Mark an instance's pixels into `mask` (raster if dims match, else bbox rect). */
function markInstance(mask: Uint8Array, inst: InstanceMask, w: number, h: number): void {
  const r = inst.raster;
  if (r && r.width === w && r.height === h) {
    for (let i = 0; i < w * h; i++) if (r.data[i] > 127) mask[i] = 1;
    return;
  }
  const x0 = clamp(Math.floor(inst.bbox.x * w), 0, w);
  const y0 = clamp(Math.floor(inst.bbox.y * h), 0, h);
  const x1 = clamp(Math.ceil((inst.bbox.x + inst.bbox.w) * w), 0, w);
  const y1 = clamp(Math.ceil((inst.bbox.y + inst.bbox.h) * h), 0, h);
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

/** Centroid (raster mass-center if dims match, else bbox center) in image px. */
function centroid(inst: InstanceMask, w: number, h: number): Point {
  const r = inst.raster;
  if (r && r.width === w && r.height === h) {
    let sx = 0, sy = 0, n = 0;
    for (let i = 0; i < w * h; i++) if (r.data[i] > 127) { sx += i % w; sy += Math.floor(i / w); n++; }
    if (n > 0) return [sx / n, sy / n];
  }
  return [(inst.bbox.x + inst.bbox.w / 2) * w, (inst.bbox.y + inst.bbox.h / 2) * h];
}

/** Dominant LAB cluster of the bare ground (in-fabric, not covered by any instance). */
function baseClothAnchor(
  buffer: Buffer,
  w: number,
  h: number,
  raster: RasterMask,
  instances: InstanceMask[]
): { L: number; a: number; b: number } | null {
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

/** Tight pixel bbox of an instance (raster if dims match, else normalized bbox). */
function instanceBBox(inst: InstanceMask, w: number, h: number) {
  const r = inst.raster;
  if (r && r.width === w && r.height === h) {
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let i = 0; i < w * h; i++) {
      if (r.data[i] > 127) {
        const x = i % w, y = Math.floor(i / w);
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
    if (x1 >= 0) return { x0, y0, x1, y1, raster: r };
  }
  const x0 = clamp(Math.floor(inst.bbox.x * w), 0, w - 1);
  const y0 = clamp(Math.floor(inst.bbox.y * h), 0, h - 1);
  const x1 = clamp(Math.ceil((inst.bbox.x + inst.bbox.w) * w) - 1, x0, w - 1);
  const y1 = clamp(Math.ceil((inst.bbox.y + inst.bbox.h) * h) - 1, y0, h - 1);
  return { x0, y0, x1, y1, raster: null as RasterMask | null };
}

/**
 * Feathered per-pixel alpha for an instance crop. Blurs the binary instance mask
 * (reuses the scaleRepeat blur->per-pixel-alpha idiom) so the composited motif
 * edge blends into the freshly-erased ground instead of hard-aliasing.
 */
async function cropAlpha(
  rasterData: Uint8Array | null,
  w: number,
  x0: number, y0: number, cw: number, ch: number,
  featherPx: number
): Promise<{ alpha: Buffer | Uint8Array; stride: number }> {
  const bin = Buffer.alloc(cw * ch);
  if (rasterData) {
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
      bin[y * cw + x] = rasterData[(y0 + y) * w + (x0 + x)] > 127 ? 255 : 0;
    }
  } else {
    bin.fill(255); // bbox fallback: the whole crop is the motif
  }
  if (featherPx < 0.3) return { alpha: bin, stride: 1 };
  const { data, info } = await sharp(bin, { raw: { width: cw, height: ch, channels: 1 } })
    .blur(featherPx)
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { alpha: data, stride: info.channels };
}

export async function densityRedistribute(input: RedistributeInput): Promise<RedistributeResult> {
  const { buffer, width, height } = await decodeUpright(input.image.url);
  const raster = input.fabric.raster;
  if (!raster) {
    throw new Error("densityRedistribute: fabric.raster required (rasterReady provider) to bound the op and sample base cloth");
  }
  if (raster.width !== width || raster.height !== height) {
    throw new Error(`densityRedistribute: raster dims ${raster.width}x${raster.height} != image ${width}x${height}`);
  }

  // No-op/passthrough: image returned unchanged, so all N motifs are still present
  // (kept = N, removed = 0). Keeps removed + kept === instances.length. removed === 0
  // still drives the caller's FAIL+REFUND, so billing is unaffected.
  const empty = (): RedistributeResult => ({ data: buffer, width, height, kept: input.instances.length, removed: 0, targets: [], assignments: [] });

  const n = input.instances.length;
  const percent = clamp(input.percent, 0, 90);
  // 4.1 count + no-op guards (parity with densityThin). percent 0 is passthrough —
  // never relocate on a no-removal request.
  if (n === 0 || percent <= 0) return empty();
  const removeN = clamp(Math.round((n * percent) / 100), 0, n);
  if (removeN === 0) return empty();
  const M = n - removeN;

  // F3: instance-raster dim drift forces a bbox-rectangle fallback in markInstance
  // that produces a grossly-corrupted redistribute. Treat it as a DEGRADE -> refund
  // (same as densityThin's F3), never billing for a corrupted result.
  const dimDrift = input.instances.filter((m) => !m.raster || m.raster.width !== width || m.raster.height !== height).length;
  if (dimDrift > 0) {
    console.warn(`[density-redistribute] ${dimDrift}/${n} instance rasters not at ${width}x${height}; degrade -> refund (no bbox over-paint).`);
    return empty();
  }

  // F2: no bare ground to sample -> refuse to smear; signal no-op so caller refunds.
  const baseClothLab = baseClothAnchor(buffer, width, height, raster, input.instances);
  if (!baseClothLab) {
    console.warn("[density-redistribute] no bare-ground pixels to sample base cloth; no-op -> refund");
    return empty();
  }

  // 4.2 even target layout — exactly M blue-noise points inside the fabric.
  const targets = blueNoiseLayout(raster, input.fabric.bbox, M, { seed: input.seed ?? 1 });
  if (targets.length === 0) return empty();

  // 4.3 assignment + survivor selection (min squared displacement).
  const srcCentroids = input.instances.map((inst) => centroid(inst, width, height));
  const { assignments } = assignTargets(srcCentroids, targets);
  if (assignments.length === 0) return empty();

  // 4.4 step 1 — erase ALL N originals to base cloth (the exact v1 erase).
  const sel = new Uint8Array(width * height);
  for (const inst of input.instances) markInstance(sel, inst, width, height);
  const grown = dilate(sel, width, height, 2);
  const region: RasterMask = { width, height, data: new Uint8Array(width * height) };
  let regionCount = 0;
  for (let i = 0; i < width * height; i++) {
    const on = grown[i] && raster.data[i] > 127;
    region.data[i] = on ? 255 : 0;
    if (on) regionCount++;
  }
  // F1: nothing erased (degenerate raster / instances outside fabric) -> refund.
  if (regionCount === 0) return empty();

  const erased = await infillBaseCloth({ image: input.image, region, baseClothLab, featherPx: 1, flatten: true });
  const out = erased.data;

  // 4.4 step 2 — composite the M survivors at their targets. No resize (scale
  // preserved), no rotate (orientation preserved). Translate each motif crop from
  // its source centroid to the assigned target centroid, alpha-blended over ground.
  for (const a of assignments) {
    const inst = input.instances[a.source];
    const bb = instanceBBox(inst, width, height);
    const cw = bb.x1 - bb.x0 + 1;
    const ch = bb.y1 - bb.y0 + 1;
    const [csx, csy] = srcCentroids[a.source];
    const [tx, ty] = targets[a.target];
    const dx = Math.round(tx - csx);
    const dy = Math.round(ty - csy);

    const { alpha, stride } = await cropAlpha(bb.raster ? bb.raster.data : null, width, bb.x0, bb.y0, cw, ch, 1);
    for (let y = 0; y < ch; y++) {
      for (let x = 0; x < cw; x++) {
        const sa = alpha[(y * cw + x) * stride] / 255;
        if (sa <= 0) continue;
        const sx = bb.x0 + x, sy = bb.y0 + y;
        const dX = sx + dx, dY = sy + dy;
        if (dX < 0 || dX >= width || dY < 0 || dY >= height) continue;
        // Clip to the fabric raster: a survivor relocated near the garment edge
        // must never paint motif pixels onto the background outside the fabric.
        if (raster.data[dY * width + dX] <= 127) continue;
        const sp = (sy * width + sx) * 4;
        const dp = (dY * width + dX) * 4;
        out[dp] = Math.round(out[dp] * (1 - sa) + buffer[sp] * sa);
        out[dp + 1] = Math.round(out[dp + 1] * (1 - sa) + buffer[sp + 1] * sa);
        out[dp + 2] = Math.round(out[dp + 2] * (1 - sa) + buffer[sp + 2] * sa);
        // alpha channel (dp + 3) preserved
      }
    }
  }

  const kept = assignments.length;
  return { data: out, width, height, kept, removed: n - kept, targets, assignments };
}
