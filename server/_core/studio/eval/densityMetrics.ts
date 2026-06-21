/**
 * Density eval metrics (Phase C). Pure functions over raw RGBA buffers + truth
 * instance labels — provider-independent, synthetic-data testable. Same
 * principles as recolor/scale (op-agnostic, truth-mask decoupling, op-correctness
 * vs mask-signal split).
 *
 * Architect rulings applied:
 *  - R1: "delete X%" is COUNT over distinct motif instances (not area). One SAM2
 *    instance = one motif; merged/overlapping clusters are not sub-split.
 *  - R2: removal is a STRATIFIED SUBSET over a grid; the evenness expectation is
 *    therefore uniform-over-cells (index-of-dispersion of removed centroids).
 *  - Thresholds: countError <= 0.10, survivorIntegrity <= 2 (op). bgDeltaE <= 2
 *    is the mask/D1 signal, EXCLUDED from verdict.pass (as recolor excludes offBg).
 */
import { rgb255ToLab, deltaE2000, type Lab } from "../ops/color";

export interface DensityMetrics {
  /** Fraction of motif instances detected as removed. */
  measuredRemoval: number;
  /** |measuredRemoval − target|. Op metric. */
  countError: number;
  /** Mean ΔE2000 (in vs out) over surviving-instance pixels. Op metric. */
  survivorIntegrity: number;
  /** Index of dispersion of removed centroids over a K-cell grid (1≈Poisson, <1 even). */
  evenness: number;
  /** Nearest-Neighbor Index R over survivor centroids within fabric area.
   *  R=1 random, R>1 dispersed, R<1 clustered. Backs evenness for the highest-risk defect. */
  nniDispersion: number;
  /** Residual edge energy in removed regions / bare-ground baseline. Op metric. */
  infillCleanliness: number;
  /** Change over truth-background pixels. Mask/D1 signal; excluded from pass. */
  bgDeltaE: number;
  totalInstances: number;
  removedInstances: number;
}

export interface DensityThresholds {
  countError?: number;        // default 0.10
  survivorIntegrity?: number; // default 2
  evenness?: number;          // default 1.5 (index of dispersion)
  nniDispersion?: number;     // default 1.0 (R >= 1 means dispersed) — back-compat lower bound
  nniMin?: number;            // default 1.0  (R >= 1 means dispersed, not clustered)
  nniMax?: number;            // default Infinity (no cap → preserves today's floor-only behavior)
  infillCleanliness?: number; // default 2.5 (× ground baseline)
  bgDeltaE?: number;          // default 2
  removedTau?: number;        // default 5 — ΔE to ground that counts a motif "erased"
}

export interface DensityMetricInput {
  source: Buffer;
  out: Buffer;
  width: number;
  height: number;
  /** 1 = fabric, 0 = background (SAM2 truth). */
  truthMask: Uint8Array;
  /** Per-pixel truth instance id: -1 = ground/non-motif, >=0 = motif instance id. */
  truthInstanceLabels: Int32Array;
  /** Requested removal fraction = X / 100. */
  targetRemovalFraction: number;
  thresholds?: DensityThresholds;
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
function groundColor(input: DensityMetricInput): Lab {
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

function meanInstanceDeltaToGround(buf: Buffer, pixels: number[], ground: Lab): number {
  let s = 0;
  for (const i of pixels) s += deltaE2000(labAt(buf, i), ground);
  return pixels.length ? s / pixels.length : 0;
}

/** Index of dispersion of removed-instance centroids over a ~K-cell grid (R2). */
function evennessScore(removedCentroids: Array<[number, number]>, bbox: { x0: number; y0: number; x1: number; y1: number }, k: number): number {
  if (removedCentroids.length < 2 || k < 2) return 0;
  const cols = Math.max(1, Math.round(Math.sqrt(k)));
  const rows = Math.max(1, Math.round(k / cols));
  const cw = (bbox.x1 - bbox.x0 + 1) / cols;
  const ch = (bbox.y1 - bbox.y0 + 1) / rows;
  const counts = new Array(cols * rows).fill(0);
  for (const [cx, cy] of removedCentroids) {
    const gx = Math.min(cols - 1, Math.max(0, Math.floor((cx - bbox.x0) / cw)));
    const gy = Math.min(rows - 1, Math.max(0, Math.floor((cy - bbox.y0) / ch)));
    counts[gy * cols + gx]++;
  }
  const mean = counts.reduce((a, b) => a + b, 0) / counts.length;
  if (mean <= 0) return 0;
  const variance = counts.reduce((a, c) => a + (c - mean) ** 2, 0) / counts.length;
  return variance / mean; // index of dispersion: 0 even, 1 Poisson, >1 clustered
}

/** Mean local gradient magnitude of luminance over a pixel set. */
function meanGradient(buf: Buffer, w: number, h: number, pixels: number[] | null, mask?: (i: number) => boolean): number {
  let s = 0, n = 0;
  const consider = (i: number) => {
    const x = i % w, y = Math.floor(i / w);
    if (x + 1 >= w || y + 1 >= h) return;
    const l0 = labAt(buf, i).l;
    const gx = Math.abs(labAt(buf, i + 1).l - l0);
    const gy = Math.abs(labAt(buf, i + w).l - l0);
    s += gx + gy; n++;
  };
  if (pixels) { for (const i of pixels) consider(i); }
  else { for (let i = 0; i < w * h; i++) if (!mask || mask(i)) consider(i); }
  return n ? s / n : 0;
}

/**
 * Nearest-Neighbor Index (Clark & Evans 1954) with Donnelly (1978) boundary correction.
 * R = observedMeanNN / expectedMeanNN. R=1 random, R>1 dispersed, R<1 clustered.
 * Returns 1.0 (neutral) when fewer than 2 points exist.
 */
export function computeNNI(
  centroids: Array<[number, number]>,
  fabricMask: Uint8Array,
  width: number,
  height: number
): number {
  const n = centroids.length;
  if (n < 2) return 1.0; // degenerate — neutral

  // Compute fabric area (number of fabric pixels)
  let fabricArea = 0;
  for (let i = 0; i < fabricMask.length; i++) {
    if (fabricMask[i]) fabricArea++;
  }
  if (fabricArea < 1) return 1.0;

  // Observed mean nearest-neighbor distance
  let nnSum = 0;
  for (let i = 0; i < n; i++) {
    let minDist = Infinity;
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const dx = centroids[i][0] - centroids[j][0];
      const dy = centroids[i][1] - centroids[j][1];
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < minDist) minDist = d;
    }
    nnSum += minDist;
  }
  const observedMean = nnSum / n;

  // Expected mean NN distance for a random pattern in area A with n points:
  // E(r) = 1 / (2 * sqrt(density)) where density = n / A
  // Donnelly correction adds boundary term: + (0.0514 + 0.041/sqrt(n)) * P/n
  const density = n / fabricArea;
  const expectedBase = 1 / (2 * Math.sqrt(density));

  // True window perimeter P: count EXPOSED pixel EDGES (4-connected) of the fabric
  // window — each fabric pixel contributes 1 per side facing non-fabric or the
  // image edge. Donnelly's P is a perimeter LENGTH, so edges (not boundary pixels)
  // are the right primitive: a solid W×H rectangle -> 2W+2H (a boundary-PIXEL count
  // gives 2W+2H−4, undersizing P -> oversizing NNI). For a SQUARE window this equals
  // 4·√A exactly, so rectangular-fabric evals are unchanged; the 4·√A approximation
  // only undersized P for elongated/irregular silhouettes.
  let perimeter = 0;
  for (let i = 0; i < fabricMask.length; i++) {
    if (!fabricMask[i]) continue;
    const x = i % width, y = (i / width) | 0;
    const up = y > 0          ? fabricMask[i - width] : 0;
    const dn = y < height - 1 ? fabricMask[i + width] : 0;
    const lf = x > 0          ? fabricMask[i - 1]     : 0;
    const rt = x < width - 1  ? fabricMask[i + 1]     : 0;
    perimeter += (up ? 0 : 1) + (dn ? 0 : 1) + (lf ? 0 : 1) + (rt ? 0 : 1);
  }
  // Optional digital-perimeter (staircase) correction: perimeter *= 0.948 (Kulpa).
  // Left as TODO(calibration) — the raw count is already a strict improvement over
  // 4·√A for irregular shapes.
  const donnellyCorrection = (0.0514 + 0.041 / Math.sqrt(n)) * perimeter / n;
  const expectedMean = expectedBase + donnellyCorrection;

  if (expectedMean <= 0) return 1.0;
  return observedMean / expectedMean;
}

export function computeDensityMetrics(input: DensityMetricInput): DensityMetrics {
  const t = input.thresholds ?? {};
  const tau = t.removedTau ?? 5;
  const groups = groupInstances(input.truthInstanceLabels);
  const total = groups.size;
  const ground = groundColor(input);

  let removed = 0;
  let survivorSum = 0, survivorN = 0;
  const removedCentroids: Array<[number, number]> = [];
  const removedPixels: number[] = [];
  let x0 = input.width, y0 = input.height, x1 = 0, y1 = 0;

  for (const pixels of Array.from(groups.values())) {
    const wasMotif = meanInstanceDeltaToGround(input.source, pixels, ground) > tau;
    const nowGround = meanInstanceDeltaToGround(input.out, pixels, ground) <= tau;
    // centroid + region bbox bookkeeping
    let cx = 0, cy = 0;
    for (const i of pixels) {
      const x = i % input.width, y = Math.floor(i / input.width);
      cx += x; cy += y; x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
    }
    cx /= pixels.length; cy /= pixels.length;

    if (wasMotif && nowGround) {
      removed++;
      removedCentroids.push([cx, cy]);
      for (const i of pixels) removedPixels.push(i);
    } else {
      for (const i of pixels) {
        survivorSum += deltaE2000(labAt(input.source, i), labAt(input.out, i));
        survivorN++;
      }
    }
  }

  // Compute survivor centroids for NNI
  const survivorCentroids: Array<[number, number]> = [];
  for (const [id, pixels] of Array.from(groups.entries())) {
    const wasMotif = meanInstanceDeltaToGround(input.source, pixels, ground) > tau;
    const nowGround = meanInstanceDeltaToGround(input.out, pixels, ground) <= tau;
    if (wasMotif && !nowGround) {
      // This is a survivor
      let cx = 0, cy = 0;
      for (const i of pixels) { cx += i % input.width; cy += Math.floor(i / input.width); }
      survivorCentroids.push([cx / pixels.length, cy / pixels.length]);
    }
  }

  const measuredRemoval = total > 0 ? removed / total : 0;
  const k = Math.max(1, Math.round(total * input.targetRemovalFraction));
  const evenness = evennessScore(removedCentroids, { x0, y0, x1, y1 }, k);

  // NNI (Nearest-Neighbor Index) over survivor centroids within fabric area.
  // R = observed mean NN distance / expected mean NN distance for random pattern.
  // Expected = 1 / (2 * sqrt(density)), where density = n / area.
  // With boundary correction (Donnelly 1978): expected = 1/(2*sqrt(d)) + (0.0514 + 0.041/sqrt(n)) * P/n
  // where P = perimeter, d = n/A.
  const nniDispersion = computeNNI(survivorCentroids, input.truthMask, input.width, input.height);

  const groundBaseline = meanGradient(input.out, input.width, input.height, null, (i) => input.truthMask[i] === 1 && input.truthInstanceLabels[i] < 0);
  const removedEnergy = removedPixels.length ? meanGradient(input.out, input.width, input.height, removedPixels) : 0;
  const infillCleanliness = groundBaseline > 1e-6 ? removedEnergy / groundBaseline : (removedEnergy > 0 ? Infinity : 0);

  let bgSum = 0, bgN = 0;
  for (let i = 0; i < input.width * input.height; i++) {
    if (input.truthMask[i]) continue;
    bgSum += deltaE2000(labAt(input.source, i), labAt(input.out, i));
    bgN++;
  }

  return {
    measuredRemoval,
    countError: Math.abs(measuredRemoval - input.targetRemovalFraction),
    survivorIntegrity: survivorN ? survivorSum / survivorN : 0,
    evenness,
    nniDispersion,
    infillCleanliness,
    bgDeltaE: bgN ? bgSum / bgN : 0,
    totalInstances: total,
    removedInstances: removed,
  };
}

/**
 * verdict.pass = op correctness (count, survivors, evenness, infill). bgDeltaE is
 * the mask/D1 signal and is EXCLUDED, exactly as recolor excludes offBg.
 */
export function densityVerdict(m: DensityMetrics, thresholds: DensityThresholds = {}) {
  const countPass = m.countError <= (thresholds.countError ?? 0.10);
  const survivorPass = m.survivorIntegrity <= (thresholds.survivorIntegrity ?? 2);
  const evennessPass = m.evenness <= (thresholds.evenness ?? 1.5);
  const nniLo = thresholds.nniMin ?? thresholds.nniDispersion ?? 1.0;
  const nniHi = thresholds.nniMax ?? Infinity; // cap rejects over-regularization (hex lattice → 2.1491)
  const nniPass = m.nniDispersion >= nniLo && m.nniDispersion <= nniHi;
  const infillPass = m.infillCleanliness <= (thresholds.infillCleanliness ?? 2.5);
  const bgPass = m.bgDeltaE <= (thresholds.bgDeltaE ?? 2);
  return { countPass, survivorPass, evennessPass, nniPass, infillPass, bgPass, pass: countPass && survivorPass && evennessPass && nniPass && infillPass };
}
