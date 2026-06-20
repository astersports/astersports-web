/**
 * Non-repeat guard for the scale-live route. Estimates whether the fabric
 * region contains a REPEATING print (periodic pattern) or a single placed
 * graphic. Uses the same biased-autocorrelation dominant-period estimator as
 * scaleMetrics.ts but operates pre-deduct on the raw source image + SAM2
 * fabric raster (no output image needed).
 *
 * The guard rejects with an honest user-facing message when periodConfidence
 * falls below the threshold, preventing the tiling op from producing garbage
 * on non-repeating inputs (e.g. a single logo placed once).
 *
 * Architect ruling: "reject a job pre-deduct when the print doesn't read as a
 * repeat (period-confidence below the eval threshold), with an honest message,
 * rather than tiling a logo."
 */
import { rgb255ToLab } from "../ops/color";

/** Minimum period confidence to proceed with scale. Below this, reject. */
export const MIN_REPEAT_CONFIDENCE = 0.2;

interface BBox { xmin: number; xmax: number; ymin: number; ymax: number }

function maskBBox(mask: Uint8Array, w: number, h: number): BBox | null {
  let xmin = w, xmax = -1, ymin = h, ymax = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (mask[y * w + x] > 127) {
        if (x < xmin) xmin = x; if (x > xmax) xmax = x;
        if (y < ymin) ymin = y; if (y > ymax) ymax = y;
      }
    }
  }
  return xmax < 0 ? null : { xmin, xmax, ymin, ymax };
}

function lum(buf: Buffer, idx: number): number {
  return rgb255ToLab(buf[idx * 4], buf[idx * 4 + 1], buf[idx * 4 + 2]).l;
}

/** Mean luminance along an axis, over masked pixels only, across the mask bbox. */
function axisSignal(buf: Buffer, w: number, mask: Uint8Array, bb: BBox, axis: "x" | "y"): number[] {
  const sig: number[] = [];
  if (axis === "x") {
    for (let x = bb.xmin; x <= bb.xmax; x++) {
      let s = 0, n = 0;
      for (let y = bb.ymin; y <= bb.ymax; y++) {
        const i = y * w + x;
        if (mask[i] > 127) { s += lum(buf, i); n++; }
      }
      sig.push(n > 0 ? s / n : NaN);
    }
  } else {
    for (let y = bb.ymin; y <= bb.ymax; y++) {
      let s = 0, n = 0;
      for (let x = bb.xmin; x <= bb.xmax; x++) {
        const i = y * w + x;
        if (mask[i] > 127) { s += lum(buf, i); n++; }
      }
      sig.push(n > 0 ? s / n : NaN);
    }
  }
  return sig;
}

/**
 * Biased autocorrelation dominant-period estimator. Identical algorithm to
 * scaleMetrics.ts:dominantPeriod — duplicated here to keep the guard
 * self-contained and avoid circular imports with the eval harness.
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

  for (let lag = minLag; lag < maxLag; lag++) {
    if (nr[lag] >= nr[lag - 1] && nr[lag] >= nr[lag + 1] && nr[lag] > 0.3) {
      return { period: lag, confidence: Math.max(0, nr[lag]) };
    }
  }
  let best = minLag, bestVal = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag++) {
    if (nr[lag] > bestVal) { bestVal = nr[lag]; best = lag; }
  }
  return { period: best, confidence: Math.max(0, bestVal) };
}

export interface RepeatCheckResult {
  /** True if the fabric reads as a repeating print (safe to scale). */
  isRepeat: boolean;
  /** Best confidence across x/y axes. */
  confidence: number;
  /** Axis-level detail for diagnostics. */
  axes: { axis: "x" | "y"; period: number; confidence: number }[];
}

/**
 * Estimate whether the fabric region of an image contains a repeating print.
 * @param imageRgba Raw RGBA buffer of the full image.
 * @param width Image width.
 * @param height Image height.
 * @param rasterData Fabric mask (SAM2 raster), same dims as image. >127 = fabric.
 * @param threshold Minimum confidence to pass (default MIN_REPEAT_CONFIDENCE).
 */
export function checkRepeat(
  imageRgba: Buffer,
  width: number,
  height: number,
  rasterData: Uint8Array,
  threshold: number = MIN_REPEAT_CONFIDENCE
): RepeatCheckResult {
  const bb = maskBBox(rasterData, width, height);
  if (!bb) return { isRepeat: false, confidence: 0, axes: [] };

  const axes: RepeatCheckResult["axes"] = [];
  for (const ax of ["x", "y"] as const) {
    const sig = axisSignal(imageRgba, width, rasterData, bb, ax);
    const { period, confidence } = dominantPeriod(sig);
    axes.push({ axis: ax, period, confidence });
  }

  const bestConf = Math.max(...axes.map(a => a.confidence));
  return {
    isRepeat: bestConf >= threshold,
    confidence: bestConf,
    axes,
  };
}
