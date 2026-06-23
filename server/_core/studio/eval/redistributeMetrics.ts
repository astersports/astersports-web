/**
 * Density v2 (Option B) eval metrics. Pure functions over raw RGBA + truth labels.
 *
 * The v1 densityMetrics does NOT transfer: it keys "removed" off SOURCE-pixel
 * labels, so when survivors RELOCATE every source site becomes ground and it
 * reports ~100% removed / zero survivors. These metrics measure FINAL positions
 * (the op's `targets`/`assignments`) instead, following the existing conventions
 * (pure fns over raw RGBA + truth; op-correctness vs mask-signal split; thresholds
 * with defaults; seed default 1).
 *
 * verdict.pass = countError && placementEvenness(NNI) && palette && perMotif &&
 * scaleFidelity && ghosting. bgDeltaE is the mask/D1 signal — reported, EXCLUDED
 * from pass (exactly as v1/recolor/scale exclude their bg signal).
 */
import { rgb255ToLab, deltaE2000, type Lab } from "../ops/color";
import { kmeans, type Vec3 } from "../ops/kmeans";
import { computeNNI } from "./densityMetrics";
import type { Point } from "../ops/blueNoiseLayout";
import type { Assignment } from "../ops/assignTargets";

export interface RedistributeMetrics {
  /** Measured removal fraction (N − Mhat)/N from FINAL target presence. */
  measuredRemoval: number;
  /** |measuredRemoval − target|. Op metric. */
  countError: number;
  /** NNI (Clark–Evans R) over FINAL survivor centroids. R>=1 dispersed (even). Op metric. */
  placementEvenness: number;
  /** kmeans-palette ΔE (source vs out, fabric region). "Same inks, moved." Op metric. */
  palette: number;
  /** Mean ΔE2000 between each survivor's source crop and its OUT target region. Op metric. */
  perMotif: number;
  /** Mean per-motif |sqrt(areaOut/areaIn) − 1| (scale preserved under composite). Op metric. */
  scaleFidelity: number;
  /** meanGradient over vacated source footprints / bare-ground baseline. Op metric. */
  infillCleanliness: number;
  /** Change over truth-background pixels. Mask/D1 signal; EXCLUDED from pass. */
  bgDeltaE: number;
  totalInstances: number;
  /** Targets that read as motif in the OUT image (Mhat). */
  presentTargets: number;
}

export interface RedistributeThresholds {
  countError?: number;       // default 0.10
  placementEvenness?: number; // default 1.0 (R >= 1 = dispersed) — NNI floor
  placementEvennessMax?: number; // default Infinity — NNI cap (rejects over-regularization → hex lattice R≈2.1491)
  palette?: number;          // default 5
  perMotif?: number;         // default 3
  scaleFidelity?: number;    // default 0.05
  infillCleanliness?: number; // default 2.5 (× ground baseline)
  bgDeltaE?: number;         // default 2
  removedTau?: number;       // default 5 — ΔE to ground that counts a motif "present"
}

export interface RedistributeMetricInput {
  source: Buffer;
  out: Buffer;
  width: number;
  height: number;
  /** 1 = fabric, 0 = background (SAM2 truth). */
  truthMask: Uint8Array;
  /** Per-pixel truth instance id: -1 = ground/non-motif, >=0 = motif instance id.
   *  In the eval harness, id === op instance index (same array order). */
  truthInstanceLabels: Int32Array;
  /** Op output: even target positions. */
  targets: Point[];
  /** Op output: matched source-instance id -> target index. */
  assignments: Assignment[];
  /** Op output: removed count (for the no-op refund guard). */
  removed: number;
  /** Requested removal fraction = X / 100. */
  targetRemovalFraction: number;
  thresholds?: RedistributeThresholds;
  seed?: number;
}

const labAt = (buf: Buffer, i: number): Lab => rgb255ToLab(buf[i * 4], buf[i * 4 + 1], buf[i * 4 + 2]);

/** Group pixel indices by instance id (>=0). */
function groupInstances(labels: Int32Array): Map<number, number[]> {
  const groups = new Map<number, number[]>();
  for (let i = 0; i < labels.length; i++) {
    const id = labels[i];
    if (id < 0) continue;
    let g = groups.get(id);
    if (!g) { g = []; groups.set(id, g); }
    g.push(i);
  }
  return groups;
}

/** Median LAB of the bare inter-motif ground (fabric pixels not in any instance). */
function groundColor(input: RedistributeMetricInput): Lab {
  const Ls: number[] = [], As: number[] = [], Bs: number[] = [];
  for (let i = 0; i < input.width * input.height; i++) {
    if (input.truthMask[i] && input.truthInstanceLabels[i] < 0) {
      const lab = labAt(input.source, i);
      Ls.push(lab.l); As.push(lab.a); Bs.push(lab.b);
    }
  }
  const med = (arr: number[]) => { if (!arr.length) return 0; const s = [...arr].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
  return { l: med(Ls), a: med(As), b: med(Bs) };
}

// ─── palette (lifted from scaleMetrics — kept local; those fns are private) ───
function fabricPalette(buf: Buffer, w: number, h: number, mask: Uint8Array, seed: number): Vec3[] {
  const pts: Vec3[] = [];
  for (let i = 0; i < w * h; i++) {
    if (!mask[i]) continue;
    if (pts.length >= 20000 && i % 3 !== 0) continue;
    const lab = rgb255ToLab(buf[i * 4], buf[i * 4 + 1], buf[i * 4 + 2]);
    pts.push([lab.l, lab.a, lab.b]);
  }
  if (pts.length === 0) return [];
  return kmeans(pts, 5, { seed }).centroids;
}

function paletteDeltaE(a: Vec3[], b: Vec3[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  let sum = 0;
  for (const c of a) {
    let best = Infinity;
    for (const d of b) {
      const e = deltaE2000({ l: c[0], a: c[1], b: c[2] }, { l: d[0], a: d[1], b: d[2] });
      if (e < best) best = e;
    }
    sum += best;
  }
  return sum / a.length;
}

/** Mean local luminance-gradient magnitude over a pixel set. */
function meanGradient(buf: Buffer, w: number, h: number, pixels: number[]): number {
  let s = 0, n = 0;
  for (const i of pixels) {
    const x = i % w, y = Math.floor(i / w);
    if (x + 1 >= w || y + 1 >= h) continue;
    const l0 = labAt(buf, i).l;
    s += Math.abs(labAt(buf, i + 1).l - l0) + Math.abs(labAt(buf, i + w).l - l0);
    n++;
  }
  return n ? s / n : 0;
}

export function computeRedistributeMetrics(input: RedistributeMetricInput): RedistributeMetrics {
  const t = input.thresholds ?? {};
  const tau = t.removedTau ?? 5;
  const seed = input.seed ?? 1;
  const { width: w, height: h } = input;
  const groups = groupInstances(input.truthInstanceLabels);
  const N = groups.size;
  const ground = groundColor(input);

  // Source centroids + areas per instance id.
  const srcCentroid = new Map<number, Point>();
  const srcArea = new Map<number, number>();
  let areaSum = 0;
  for (const [id, pixels] of Array.from(groups.entries())) {
    let cx = 0, cy = 0;
    for (const i of pixels) { cx += i % w; cy += Math.floor(i / w); }
    srcCentroid.set(id, [cx / pixels.length, cy / pixels.length]);
    srcArea.set(id, pixels.length);
    areaSum += pixels.length;
  }
  const meanSrcArea = N ? areaSum / N : 0;
  const windowR = Math.max(1, Math.sqrt(meanSrcArea / Math.PI));

  // countError — Mhat = targets whose OUT disk-window (motif-radius) reads as motif.
  const outReadsMotif = (cx: number, cy: number): { motif: boolean; area: number } => {
    let sum = 0, cnt = 0, area = 0;
    const r = Math.ceil(windowR);
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > windowR * windowR) continue;
        const x = Math.round(cx) + dx, y = Math.round(cy) + dy;
        if (x < 0 || x >= w || y < 0 || y >= h) continue;
        const de = deltaE2000(labAt(input.out, y * w + x), ground);
        sum += de; cnt++;
        if (de > tau) area++;
      }
    }
    return { motif: cnt > 0 && sum / cnt > tau, area };
  };
  let presentTargets = 0;
  for (const [tx, ty] of input.targets) if (outReadsMotif(tx, ty).motif) presentTargets++;
  const measuredRemoval = N ? (N - presentTargets) / N : 0;
  const countError = Math.abs(measuredRemoval - input.targetRemovalFraction);

  // placementEvenness — NNI over FINAL survivor centroids (the targets).
  const placementEvenness = computeNNI(input.targets as Array<[number, number]>, input.truthMask, w, h);

  // palette — same inks, moved.
  const palette = paletteDeltaE(
    fabricPalette(input.source, w, h, input.truthMask, seed),
    fabricPalette(input.out, w, h, input.truthMask, seed)
  );

  // Per-motif fidelity + scale fidelity + the survivor "covered" mask for ghosting.
  const covered = new Uint8Array(w * h);
  let perMotifSum = 0, perMotifN = 0;
  let scaleSum = 0, scaleN = 0;
  for (const a of input.assignments) {
    const pixels = groups.get(a.source);
    const c = srcCentroid.get(a.source);
    const target = input.targets[a.target];
    if (!pixels || !c || !target) continue;
    const dx = Math.round(target[0] - c[0]);
    const dy = Math.round(target[1] - c[1]);
    let areaOut = 0;
    for (const i of pixels) {
      const sx = i % w, sy = Math.floor(i / w);
      const ox = sx + dx, oy = sy + dy;
      if (ox < 0 || ox >= w || oy < 0 || oy >= h) continue;
      const oi = oy * w + ox;
      covered[oi] = 1;
      perMotifSum += deltaE2000(labAt(input.source, i), labAt(input.out, oi));
      perMotifN++;
      if (deltaE2000(labAt(input.out, oi), ground) > tau) areaOut++;
    }
    const areaIn = srcArea.get(a.source) ?? pixels.length;
    if (areaIn > 0) { scaleSum += Math.abs(Math.sqrt(areaOut / areaIn) - 1); scaleN++; }
  }
  const perMotif = perMotifN ? perMotifSum / perMotifN : 0;
  const scaleFidelity = scaleN ? scaleSum / scaleN : 0;

  // ghosting — vacated source footprints (NOT re-covered by a survivor) vs ground.
  const footprint: number[] = [];
  const bareGround: number[] = [];
  for (let i = 0; i < w * h; i++) {
    if (input.truthInstanceLabels[i] >= 0) { if (!covered[i]) footprint.push(i); }
    else if (input.truthMask[i] && !covered[i]) bareGround.push(i);
  }
  const groundBaseline = meanGradient(input.out, w, h, bareGround);
  const removedEnergy = footprint.length ? meanGradient(input.out, w, h, footprint) : 0;
  const infillCleanliness = groundBaseline > 1e-6 ? removedEnergy / groundBaseline : (removedEnergy > 0 ? Infinity : 0);

  // bgDeltaE — mask/D1 signal, excluded from pass.
  let bgSum = 0, bgN = 0;
  for (let i = 0; i < w * h; i++) {
    if (input.truthMask[i]) continue;
    bgSum += deltaE2000(labAt(input.source, i), labAt(input.out, i));
    bgN++;
  }

  return {
    measuredRemoval,
    countError,
    placementEvenness,
    palette,
    perMotif,
    scaleFidelity,
    infillCleanliness,
    bgDeltaE: bgN ? bgSum / bgN : 0,
    totalInstances: N,
    presentTargets,
  };
}

/**
 * verdict.pass = op correctness (count, evenness, palette, per-motif, scale,
 * ghosting) AND not a no-op (removed > 0). bgDeltaE is the mask/D1 signal and is
 * EXCLUDED, exactly as v1/recolor/scale exclude their bg signal.
 */
export function redistributeVerdict(m: RedistributeMetrics, removed: number, thresholds: RedistributeThresholds = {}) {
  const countPass = m.countError <= (thresholds.countError ?? 0.10);
  // Two-sided NNI band (parity with v1 densityVerdict's nniMin/nniMax): a FLOOR
  // rejects clustering, a CAP rejects over-regularization. blueNoiseLayout deliberately
  // stops Lloyd short of convergence to avoid drifting into a crystalline hex lattice
  // (NNI → 2.1491); with only a floor, the SHIPPING verdict cannot detect that failure.
  // Default cap is Infinity (no behaviour change) until the G3 real-garment eval calibrates it.
  const evennessLo = thresholds.placementEvenness ?? 1.0;
  const evennessHi = thresholds.placementEvennessMax ?? Infinity;
  const evennessPass = m.placementEvenness >= evennessLo && m.placementEvenness <= evennessHi;
  const palettePass = m.palette <= (thresholds.palette ?? 5);
  const perMotifPass = m.perMotif <= (thresholds.perMotif ?? 3);
  const scalePass = m.scaleFidelity <= (thresholds.scaleFidelity ?? 0.05);
  const infillPass = m.infillCleanliness <= (thresholds.infillCleanliness ?? 2.5);
  const bgPass = m.bgDeltaE <= (thresholds.bgDeltaE ?? 2);
  const noopPass = removed > 0;
  return {
    countPass, evennessPass, palettePass, perMotifPass, scalePass, infillPass, bgPass, noopPass,
    pass: countPass && evennessPass && palettePass && perMotifPass && scalePass && infillPass && noopPass,
  };
}
