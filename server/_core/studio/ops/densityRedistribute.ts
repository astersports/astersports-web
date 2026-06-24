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
 * Default off behind ENV.studioDensityRedistribute. When the flag is on,
 * studioEngine.runVariation selects this op over the v1 erase-only densityThin on the
 * live density money path (remove p%, then relocate survivors to an even blue-noise
 * layout); when off, density runs v1. The flag flip itself stays Frank's (CLAUDE.md §1
 * human-on-flip).
 */
import sharp from "sharp";
import { decodeUpright } from "../../image/decodeUpright";
import { rgb255ToLab } from "./color";
import { kmeans, type Vec3 } from "./kmeans";
import { infillBaseCloth, type InfillResult } from "./infill";
import { lamaInfill, isLamaAvailable } from "./lamaInfill";
import { blueNoiseLayout, type Point } from "./blueNoiseLayout";
import { assignTargets, type Assignment } from "./assignTargets";
import type { MaskImageInput, FabricMask, InstanceMask, RasterMask, BBoxNormalized } from "../../masking/types";

export interface RedistributeInput {
  image: MaskImageInput;
  fabric: FabricMask; // MUST carry .raster; bounds the op + base-cloth sampling
  instances: InstanceMask[];
  percent: number; // 0..90. X% of instances to remove before redistributing.
  /** Blue-noise relaxation seed (matches kmeans({seed})). Default 1. */
  seed?: number;
  /** T2.1: When true, use LaMa texture-aware infill instead of flat LAB.
   *  Falls back to LAB on error or when LaMa is unavailable. */
  useLama?: boolean;
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

/** A surviving instance and the even target it relocates to. */
type Placement = { instIdx: number; target: Point };

/** Pixel area of an instance (raster mass if dims match, else bbox rectangle). */
function instanceArea(inst: InstanceMask, w: number, h: number): number {
  const r = inst.raster;
  if (r && r.width === w && r.height === h) {
    let a = 0;
    for (let i = 0; i < w * h; i++) if (r.data[i] > 127) a++;
    return a;
  }
  return Math.max(1, Math.round(inst.bbox.w * w) * Math.round(inst.bbox.h * h));
}

/**
 * Plan which motifs survive and where each relocates, EMPHASISING the main blooms.
 *
 * Classify instances by pixel area: "main" = at/above the mean motif area (a skewed
 * floral — many small buds/leaves, few large blooms — puts the blooms above the mean).
 * Remove the SECONDARY bits at ~2x the rate of the MAIN blooms (so blooms are kept and
 * dominate), while keeping removeMain + removeSec === removeN so total reduction (and
 * billing) is unchanged. Lay blooms and bits out on SEPARATE even (blue-noise) layers so
 * the blooms read as the key even rhythm and the bits evenly fill around them; bits are
 * listed first so blooms composite on top where they overlap.
 *
 * Degenerate split (one class empty — e.g. uniform motifs): fall back to a single even
 * layout of all M survivors (the prior v2 behaviour; keeps the count tests exact).
 */
function planPlacements(
  instances: InstanceMask[],
  srcCentroids: Point[],
  boundary: RasterMask,
  bbox: BBoxNormalized,
  removeN: number,
  width: number,
  height: number,
  seed: number
): Placement[] {
  const n = instances.length;
  const M = n - removeN;
  const areas = instances.map((inst) => instanceArea(inst, width, height));
  const mean = areas.reduce((a, b) => a + b, 0) / n;
  const mainIdx: number[] = [];
  const secIdx: number[] = [];
  instances.forEach((_, i) => (areas[i] >= mean ? mainIdx : secIdx).push(i));

  // Degenerate split -> single even layout of all survivors (prior behaviour).
  if (mainIdx.length === 0 || secIdx.length === 0) {
    const targets = blueNoiseLayout(boundary, bbox, M, { seed });
    if (targets.length === 0) return [];
    const { assignments } = assignTargets(srcCentroids, targets);
    return assignments.map((a) => ({ instIdx: a.source, target: targets[a.target] }));
  }

  // Tiered removal: secondary bits removed at ~2x the main rate; total === removeN.
  const r = removeN / (mainIdx.length + 2 * secIdx.length);
  let removeMain = clamp(Math.round(r * mainIdx.length), 0, mainIdx.length);
  let removeSec = clamp(removeN - removeMain, 0, secIdx.length);
  removeMain = clamp(removeN - removeSec, 0, mainIdx.length); // rebalance if bits ran out
  const Mmain = mainIdx.length - removeMain;
  const Msec = secIdx.length - removeSec;

  const mainTargets = blueNoiseLayout(boundary, bbox, Mmain, { seed });
  const secTargets = blueNoiseLayout(boundary, bbox, Msec, { seed: seed + 7 });
  const am = assignTargets(mainIdx.map((i) => srcCentroids[i]), mainTargets);
  const as = assignTargets(secIdx.map((i) => srcCentroids[i]), secTargets);

  // Bits first, blooms last (blooms composite on top of any overlap).
  return [
    ...as.assignments.map((a) => ({ instIdx: secIdx[a.source], target: secTargets[a.target] })),
    ...am.assignments.map((a) => ({ instIdx: mainIdx[a.source], target: mainTargets[a.target] })),
  ];
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

  // DUAL MASK (Option B): the garment silhouette boundary drives layout + clip.
  // Validated and bound below (Fix 3) — no silent full-crop fallback.

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

  // F3: instance-raster dim drift forces a bbox-rectangle fallback in markInstance
  // that produces a grossly-corrupted redistribute. Treat it as a DEGRADE -> refund
  // (same as densityThin's F3), never billing for a corrupted result.
  const dimDrift = input.instances.filter((m) => !m.raster || m.raster.width !== width || m.raster.height !== height).length;
  if (dimDrift > 0) {
    console.warn(`[density-redistribute] ${dimDrift}/${n} instance rasters not at ${width}x${height}; degrade -> refund (no bbox over-paint).`);
    return empty();
  }

  // Fix 3 (Pillar 1): require a real garment silhouette. Do NOT silently fall back to
  // the full-crop sampling raster as the boundary — that lets blueNoiseLayout place and
  // the compositing clip paint motifs onto off-garment background (the clip degrades to
  // "the entire bbox"). A missing or all-zero boundaryRaster is a DEGRADE -> refund
  // (parity with the !raster guard above). The all-zero case already refunded via the F2
  // / blueNoise empty-mask paths; this makes it explicit and avoids the silent fallback.
  const boundary = input.fabric.boundaryRaster;
  if (!boundary) {
    console.warn("[density-redistribute] boundaryRaster absent; degrade -> refund (no full-crop boundary fallback).");
    return empty();
  }
  // T1.1 (GAP-1): boundary dimension guard. A mis-sized boundaryRaster silently corrupts
  // the composite (motifs placed/clipped against wrong coordinates). This is the ONE
  // reachable path to a corrupted PAID image that still bills. Degrade -> refund.
  if (boundary.width !== width || boundary.height !== height) {
    console.warn(`[density-redistribute] boundaryRaster dimension mismatch: boundary ${boundary.width}x${boundary.height} vs image ${width}x${height}; degrade -> refund.`);
    return empty();
  }
  let boundaryArea = 0;
  for (let i = 0; i < boundary.data.length; i++) if (boundary.data[i] > 127) boundaryArea++;
  if (boundaryArea === 0) {
    console.warn("[density-redistribute] boundaryRaster all-zero (degenerate silhouette); degrade -> refund.");
    return empty();
  }

  // F2: no bare ground to sample -> refuse to smear; signal no-op so caller refunds.
  // Use the BOUNDARY raster for base-cloth sampling so we only sample pixels that are
  // actually on the garment (not the background wall visible through the crop bbox).
  const baseClothLab = baseClothAnchor(buffer, width, height, boundary, input.instances);
  if (!baseClothLab) {
    console.warn("[density-redistribute] no bare-ground pixels to sample base cloth; no-op -> refund");
    return empty();
  }

  // 4.2/4.3 size-tiered survivor layout (planPlacements): emphasise the MAIN blooms (own
  // even rhythm) and thin the SECONDARY bits more (own even layer), inside the GARMENT
  // SILHOUETTE (boundaryRaster). Total removal === removeN, so billing is unchanged.
  const srcCentroids = input.instances.map((inst) => centroid(inst, width, height));
  const placements = planPlacements(
    input.instances, srcCentroids, boundary, input.fabric.bbox, removeN, width, height, input.seed ?? 1
  );
  if (placements.length === 0) return empty();

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

  // T2.1: LaMa texture-aware infill (with flat LAB fallback).
  let out: Buffer;
  if (input.useLama && isLamaAvailable()) {
    try {
      const lamaResult = await lamaInfill({ imageRgba: buffer, width, height, region });
      out = lamaResult.data;
      console.log(`[redistribute] LaMa infill ${lamaResult.fromCache ? "(cached)" : "(fresh)"}`);
    } catch (err) {
      console.warn(`[redistribute] LaMa failed, falling back to flat LAB: ${(err as Error).message}`);
      const erased = await infillBaseCloth({ image: input.image, region, baseClothLab, featherPx: 1, flatten: true });
      out = erased.data;
    }
  } else {
    const erased = await infillBaseCloth({ image: input.image, region, baseClothLab, featherPx: 1, flatten: true });
    out = erased.data;
  }

  // 4.4 step 2 — composite each surviving motif at its even target. No resize (scale
  // preserved), no rotate (orientation preserved). Translate each motif crop from its
  // source centroid to the assigned target centroid, alpha-blended over ground.
  for (const pl of placements) {
    const inst = input.instances[pl.instIdx];
    const bb = instanceBBox(inst, width, height);
    const cw = bb.x1 - bb.x0 + 1;
    const ch = bb.y1 - bb.y0 + 1;
    const [csx, csy] = srcCentroids[pl.instIdx];
    const [tx, ty] = pl.target;
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
        // Clip to the garment BOUNDARY: a survivor relocated near the garment edge
        // must never paint motif pixels onto the background outside the silhouette.
        if (boundary.data[dY * width + dX] <= 127) continue;
        const sp = (sy * width + sx) * 4;
        const dp = (dY * width + dX) * 4;
        out[dp] = Math.round(out[dp] * (1 - sa) + buffer[sp] * sa);
        out[dp + 1] = Math.round(out[dp + 1] * (1 - sa) + buffer[sp + 1] * sa);
        out[dp + 2] = Math.round(out[dp + 2] * (1 - sa) + buffer[sp + 2] * sa);
        // alpha channel (dp + 3) preserved
      }
    }
  }

  const kept = placements.length;
  const targets = placements.map((p) => p.target);
  const assignments: Assignment[] = placements.map((p, i) => ({ source: p.instIdx, target: i }));
  return { data: out, width, height, kept, removed: n - kept, targets, assignments };
}
