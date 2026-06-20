/**
 * Scale eval metrics (Phase B). Pure functions over raw RGBA buffers — no I/O,
 * provider-independent, synthetic-data testable. Mirrors the recolor eval
 * structure and inherits its principles (op-agnostic, SAM2 truth-mask
 * decoupling, op-correctness vs mask-signal split, PNGs primary).
 *
 * Architect rulings applied:
 *  - R3: repeat-PERIOD (autocorrelation) is the PRIMARY scale estimator;
 *    motif-area-ratio (from truth instance masks) is the FALLBACK for
 *    sparse/non-periodic prints. Report which ran. Both directions supported.
 *  - Thresholds: scaleRatioError <= 0.15 (op gate, supersedes ±10% —
 *    autocorrelation has quantization at small motifs; PNG is the arbiter near
 *    threshold). paletteDeltaE <= 5 (op). poseBgDeltaE <= 2 is the mask/D1 signal
 *    and is EXCLUDED from verdict.pass. A fabric-silhouette IoU gate is added only
 *    when the generative relight pass is enabled (not here — the deterministic
 *    composite cannot move the silhouette without moving the background).
 */
import { rgb255ToLab, deltaE2000 } from "../ops/color";
import { kmeans, type Vec3 } from "../ops/kmeans";

export interface ScaleMetrics {
  /** Linear scale fraction the output achieved vs the input (0.5 = half size). */
  measuredFraction: number;
  /** |measuredFraction − targetFraction| / targetFraction. */
  scaleRatioError: number;
  /** Which estimator produced measuredFraction. */
  estimator: "period" | "area";
  /** Normalized autocorrelation peak (0..1); low => period estimate unreliable. */
  periodConfidence: number;
  /** Same inks, just resized — palette preserved. Op metric. */
  paletteDeltaE: number;
  /** Change over truth-background pixels. Mask/D1 signal; excluded from pass. */
  poseBgDeltaE: number;
}

export interface ScaleThresholds {
  ratioError?: number;        // default 0.15
  paletteDeltaE?: number;     // default 5
  poseBgDeltaE?: number;      // default 2
  minPeriodConfidence?: number; // default 0.2; below this, use the area fallback
}

export interface ScaleMetricInput {
  source: Buffer;
  out: Buffer;
  width: number;
  height: number;
  /** 1 = fabric, 0 = background (SAM2 truth). */
  truthMask: Uint8Array;
  /** Requested linear scale fraction = (100 + percent) / 100. */
  targetFraction: number;
  /** Mean motif area (px) from truth instance masks; enables the area fallback. */
  areaFallback?: { sourceMeanArea: number; outMeanArea: number };
  thresholds?: ScaleThresholds;
  seed?: number;
}

// ─── period estimation (autocorrelation) ────────────────────────────────────

interface BBox { xmin: number; xmax: number; ymin: number; ymax: number; }

function maskBBox(mask: Uint8Array, w: number, h: number): BBox | null {
  let xmin = w, xmax = -1, ymin = h, ymax = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (mask[y * w + x]) {
        if (x < xmin) xmin = x; if (x > xmax) xmax = x;
        if (y < ymin) ymin = y; if (y > ymax) ymax = y;
      }
    }
  }
  return xmax < 0 ? null : { xmin, xmax, ymin, ymax };
}

const lum = (buf: Buffer, idx: number): number => rgb255ToLab(buf[idx * 4], buf[idx * 4 + 1], buf[idx * 4 + 2]).l;

/** Mean luminance along an axis, over masked pixels only, across the mask bbox. */
function axisSignal(buf: Buffer, w: number, mask: Uint8Array, bb: BBox, axis: "x" | "y"): number[] {
  const sig: number[] = [];
  if (axis === "x") {
    for (let x = bb.xmin; x <= bb.xmax; x++) {
      let s = 0, n = 0;
      for (let y = bb.ymin; y <= bb.ymax; y++) {
        const i = y * w + x;
        if (mask[i]) { s += lum(buf, i); n++; }
      }
      sig.push(n > 0 ? s / n : NaN);
    }
  } else {
    for (let y = bb.ymin; y <= bb.ymax; y++) {
      let s = 0, n = 0;
      for (let x = bb.xmin; x <= bb.xmax; x++) {
        const i = y * w + x;
        if (mask[i]) { s += lum(buf, i); n++; }
      }
      sig.push(n > 0 ? s / n : NaN);
    }
  }
  return sig;
}

/**
 * Dominant period of a 1-D signal via BIASED autocorrelation (divide by n, which
 * tapers high lags and suppresses spurious peaks) + the first prominent local
 * maximum = the fundamental period.
 */
function dominantPeriod(sig: number[]): { period: number; confidence: number } {
  const vals = sig.filter((v) => Number.isFinite(v));
  const n = vals.length;
  if (n < 8) return { period: 0, confidence: 0 };
  const mean = vals.reduce((a, b) => a + b, 0) / n;
  const v = vals.map((x) => x - mean);
  const r0 = v.reduce((a, b) => a + b * b, 0) / n;
  if (r0 <= 1e-9) return { period: 0, confidence: 0 };

  const minLag = Math.max(3, Math.floor(n * 0.03));
  const maxLag = Math.floor(n / 2);
  const nr: number[] = new Array(maxLag + 1).fill(0);
  for (let lag = 0; lag <= maxLag; lag++) {
    let c = 0;
    for (let i = 0; i + lag < n; i++) c += v[i] * v[i + lag];
    nr[lag] = c / n / r0;
  }

  // First prominent local maximum after the initial descent = fundamental period.
  for (let lag = minLag; lag < maxLag; lag++) {
    if (nr[lag] >= nr[lag - 1] && nr[lag] >= nr[lag + 1] && nr[lag] > 0.3) {
      return { period: lag, confidence: Math.max(0, nr[lag]) };
    }
  }
  // Fallback: global argmax over the search range.
  let best = minLag, bestVal = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag++) {
    if (nr[lag] > bestVal) { bestVal = nr[lag]; best = lag; }
  }
  return { period: best, confidence: Math.max(0, bestVal) };
}

/** Combined repeat fraction (x & y) between two images over the same truth mask. */
function periodFraction(input: ScaleMetricInput): { fraction: number; confidence: number } {
  const bbS = maskBBox(input.truthMask, input.width, input.height);
  if (!bbS) return { fraction: NaN, confidence: 0 };
  const axes: ("x" | "y")[] = ["x", "y"];
  const fractions: number[] = [];
  const confs: number[] = [];
  for (const ax of axes) {
    const pIn = dominantPeriod(axisSignal(input.source, input.width, input.truthMask, bbS, ax));
    const pOut = dominantPeriod(axisSignal(input.out, input.width, input.truthMask, bbS, ax));
    if (pIn.period > 0 && pOut.period > 0) {
      fractions.push(pOut.period / pIn.period);
      confs.push(Math.min(pIn.confidence, pOut.confidence));
    }
  }
  if (fractions.length === 0) return { fraction: NaN, confidence: 0 };
  return {
    fraction: fractions.reduce((a, b) => a + b, 0) / fractions.length,
    confidence: Math.min(...confs),
  };
}

// ─── palette + background ────────────────────────────────────────────────────

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

function backgroundDeltaE(input: ScaleMetricInput): number {
  let sum = 0, n = 0;
  for (let i = 0; i < input.width * input.height; i++) {
    if (input.truthMask[i]) continue;
    const p = i * 4;
    sum += deltaE2000(
      rgb255ToLab(input.source[p], input.source[p + 1], input.source[p + 2]),
      rgb255ToLab(input.out[p], input.out[p + 1], input.out[p + 2])
    );
    n++;
  }
  return n > 0 ? sum / n : 0;
}

// ─── public API ──────────────────────────────────────────────────────────────

export function computeScaleMetrics(input: ScaleMetricInput): ScaleMetrics {
  const minConf = input.thresholds?.minPeriodConfidence ?? 0.2;
  const seed = input.seed ?? 1;

  const per = periodFraction(input);
  let estimator: "period" | "area" = "period";
  let measuredFraction = per.fraction;

  // R3: fall back to motif-area-ratio when the period estimate is unreliable.
  const periodUsable = Number.isFinite(per.fraction) && per.confidence >= minConf;
  if (!periodUsable && input.areaFallback && input.areaFallback.sourceMeanArea > 0) {
    estimator = "area";
    measuredFraction = Math.sqrt(input.areaFallback.outMeanArea / input.areaFallback.sourceMeanArea);
  }

  const scaleRatioError =
    Number.isFinite(measuredFraction) && input.targetFraction > 0
      ? Math.abs(measuredFraction - input.targetFraction) / input.targetFraction
      : Infinity;

  const srcPal = fabricPalette(input.source, input.width, input.height, input.truthMask, seed);
  const outPal = fabricPalette(input.out, input.width, input.height, input.truthMask, seed);

  return {
    measuredFraction,
    scaleRatioError,
    estimator,
    periodConfidence: per.confidence,
    paletteDeltaE: paletteDeltaE(srcPal, outPal),
    poseBgDeltaE: backgroundDeltaE(input),
  };
}

/**
 * verdict.pass = op correctness (scaleRatioError && paletteDeltaE). poseBgDeltaE
 * is the mask/D1 signal (a bbox composite rescales swept-in background; the
 * precise mask fixes it) and is reported but EXCLUDED from pass, exactly as
 * recolor excludes offBg.
 */
export function scaleVerdict(m: ScaleMetrics, thresholds: ScaleThresholds = {}) {
  const ratioPass = m.scaleRatioError <= (thresholds.ratioError ?? 0.15);
  const palettePass = m.paletteDeltaE <= (thresholds.paletteDeltaE ?? 5);
  const poseBgPass = m.poseBgDeltaE <= (thresholds.poseBgDeltaE ?? 2);
  return { ratioPass, palettePass, poseBgPass, pass: ratioPass && palettePass };
}
