/**
 * FFT-propose + autocorrelation-validate repeat detector (Decision 3, § 5, § 12).
 *
 * Classifies a fabric image as ALLOVER (repeating print) vs PLACEMENT/BORDER/SINGLE.
 * This is the calibration-ready upgrade to the interim `periodConfidence >= 0.2` floor
 * in `repeatGuard.ts`.
 *
 * Algorithm (two-stage):
 *   1. FFT-propose: compute 1D power spectrum on each axis (x, y) of the luminance
 *      signal within the fabric mask. Identify peaks in the spectrum. Compute:
 *      - peakRatio: height of dominant non-DC peak / DC component
 *      - periodicityEnergy: fraction of total spectral energy in periodic peaks
 *      - peakCount: number of evenly-spaced harmonic peaks per axis
 *
 *   2. Autocorrelation-validate: confirm the FFT-proposed period with the existing
 *      autocorrelation estimator. A period is validated when autocorrelation at the
 *      proposed lag exceeds a confirmation threshold.
 *
 * Classification (from spec § 5):
 *   ALLOVER: peakRatio >= 0.30 AND periodicityEnergy >= 0.50 AND at least 2 even
 *   peaks on BOTH axes AND the tile repeats at least 2.5 times.
 *   BORDER: periodicity on one axis only → rejected.
 *   PLACEMENT/SINGLE: fails all criteria → rejected.
 *
 * These thresholds are CALIBRATION STARTING POINTS (spec: "not frozen constants").
 * The detector must be calibrated on a labeled garment set before the Scale flag flips.
 *
 * Integration: `checkRepeatAdvanced` is the upgraded entry point. It returns the same
 * `RepeatCheckResult` interface as the current `checkRepeat` for drop-in compatibility,
 * plus additional diagnostics for the calibration report.
 */

import { rgb255ToLab } from "../ops/color";

// ─── Calibration thresholds (starting points, not frozen) ───────────────────

/** Minimum peak-to-DC ratio in the power spectrum to propose a period. */
export const PEAK_RATIO_THRESHOLD = 0.30;

/** Minimum fraction of spectral energy in periodic peaks. */
export const PERIODICITY_ENERGY_THRESHOLD = 0.50;

/** Minimum number of evenly-spaced harmonic peaks per axis. */
export const MIN_HARMONIC_PEAKS = 2;

/** Minimum tile repeats along an axis (signal length / period). */
export const MIN_TILE_REPEATS = 2.5;

/** Autocorrelation confirmation threshold for the FFT-proposed period. */
export const AUTOCORR_CONFIRM_THRESHOLD = 0.25;

// ─── Types ──────────────────────────────────────────────────────────────────

export interface AxisDiagnostics {
  axis: "x" | "y";
  /** Dominant non-DC peak frequency (bin index). */
  peakBin: number;
  /** Proposed period in pixels (signal_length / peakBin). */
  proposedPeriod: number;
  /** Peak-to-DC ratio. */
  peakRatio: number;
  /** Fraction of spectral energy in harmonic peaks. */
  periodicityEnergy: number;
  /** Number of evenly-spaced harmonic peaks found. */
  harmonicPeakCount: number;
  /** Number of tile repeats (signal_length / period). */
  tileRepeats: number;
  /** Autocorrelation at the proposed period lag. */
  autocorrAtPeriod: number;
  /** Whether this axis passes all criteria. */
  passes: boolean;
}

export interface RepeatDetectorResult {
  /** True if classified as allover (repeating on both axes). */
  isAllover: boolean;
  /** True if periodic on exactly one axis (border print). */
  isBorder: boolean;
  /** Combined confidence (max autocorr across passing axes, or 0). */
  confidence: number;
  /** Per-axis diagnostics for calibration reporting. */
  axes: AxisDiagnostics[];
  /** Classification label for reporting. */
  classification: "allover" | "border" | "placement" | "insufficient_data";
}

// ─── Helpers ────────────────────────────────────────────────────────────────

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

/** Mean luminance signal along an axis, masked pixels only. */
function axisSignal(buf: Buffer, w: number, mask: Uint8Array, bb: BBox, axis: "x" | "y"): number[] {
  const sig: number[] = [];
  if (axis === "x") {
    for (let x = bb.xmin; x <= bb.xmax; x++) {
      let s = 0, n = 0;
      for (let y = bb.ymin; y <= bb.ymax; y++) {
        const i = y * w + x;
        if (mask[i] > 127) { s += lum(buf, i); n++; }
      }
      sig.push(n > 0 ? s / n : 0);
    }
  } else {
    for (let y = bb.ymin; y <= bb.ymax; y++) {
      let s = 0, n = 0;
      for (let x = bb.xmin; x <= bb.xmax; x++) {
        const i = y * w + x;
        if (mask[i] > 127) { s += lum(buf, i); n++; }
      }
      sig.push(n > 0 ? s / n : 0);
    }
  }
  return sig;
}

// ─── FFT (real-valued, radix-2 DFT via Bluestein's chirp-z for arbitrary N) ─

/**
 * Compute power spectrum of a real signal. Returns magnitude² for each frequency bin.
 * Uses a simple O(N²) DFT for correctness and simplicity (signals are typically
 * 500-2000 samples — well within budget for a pre-deduct guard).
 */
function powerSpectrum(signal: number[]): number[] {
  const N = signal.length;
  if (N === 0) return [];

  // Remove DC (mean) before computing spectrum
  const mean = signal.reduce((a, b) => a + b, 0) / N;
  const centered = signal.map(v => v - mean);

  const spectrum = new Array(Math.floor(N / 2) + 1);
  for (let k = 0; k < spectrum.length; k++) {
    let re = 0, im = 0;
    const w = (-2 * Math.PI * k) / N;
    for (let n = 0; n < N; n++) {
      re += centered[n] * Math.cos(w * n);
      im += centered[n] * Math.sin(w * n);
    }
    spectrum[k] = (re * re + im * im) / (N * N);
  }
  return spectrum;
}

/**
 * Find peaks in the power spectrum. A peak is a local maximum above a noise floor.
 * Returns sorted by magnitude (descending).
 */
function findPeaks(spectrum: number[], minBin: number = 2): Array<{ bin: number; magnitude: number }> {
  const peaks: Array<{ bin: number; magnitude: number }> = [];
  const noiseFloor = spectrum.reduce((a, b) => a + b, 0) / spectrum.length;

  for (let i = Math.max(minBin, 1); i < spectrum.length - 1; i++) {
    if (spectrum[i] > spectrum[i - 1] && spectrum[i] > spectrum[i + 1] && spectrum[i] > noiseFloor * 2) {
      peaks.push({ bin: i, magnitude: spectrum[i] });
    }
  }

  return peaks.sort((a, b) => b.magnitude - a.magnitude);
}

/**
 * Count evenly-spaced harmonic peaks. Given a fundamental frequency bin,
 * count how many of its harmonics (2f, 3f, 4f...) also appear as peaks.
 */
function countHarmonics(peaks: Array<{ bin: number; magnitude: number }>, fundamentalBin: number, tolerance: number = 0.15): number {
  let count = 1; // the fundamental itself
  const peakBins = new Set(peaks.map(p => p.bin));

  for (let harmonic = 2; harmonic <= 8; harmonic++) {
    const expectedBin = Math.round(fundamentalBin * harmonic);
    // Check if any peak is within tolerance of the expected harmonic
    const tolBins = Math.max(1, Math.round(fundamentalBin * tolerance));
    let found = false;
    for (let b = expectedBin - tolBins; b <= expectedBin + tolBins; b++) {
      if (peakBins.has(b)) { found = true; break; }
    }
    if (found) count++;
  }
  return count;
}

/**
 * Normalized autocorrelation at a specific lag.
 */
function autocorrelationAtLag(signal: number[], lag: number): number {
  const N = signal.length;
  if (lag >= N || lag <= 0) return 0;

  const mean = signal.reduce((a, b) => a + b, 0) / N;
  const centered = signal.map(v => v - mean);
  const r0 = centered.reduce((a, b) => a + b * b, 0) / N;
  if (r0 <= 1e-9) return 0;

  let c = 0;
  for (let i = 0; i + lag < N; i++) c += centered[i] * centered[i + lag];
  return c / N / r0;
}

// ─── Main detector ──────────────────────────────────────────────────────────

/**
 * Analyze one axis: FFT-propose then autocorrelation-validate.
 */
function analyzeAxis(
  signal: number[],
  axis: "x" | "y"
): AxisDiagnostics {
  const N = signal.length;
  const empty: AxisDiagnostics = {
    axis, peakBin: 0, proposedPeriod: 0, peakRatio: 0,
    periodicityEnergy: 0, harmonicPeakCount: 0, tileRepeats: 0,
    autocorrAtPeriod: 0, passes: false,
  };

  if (N < 16) return empty;

  // Stage 1: FFT-propose
  const spectrum = powerSpectrum(signal);
  const dcPower = spectrum[0] || 1e-9; // DC component (should be ~0 after centering, use total energy)
  const totalEnergy = spectrum.reduce((a, b) => a + b, 0) || 1e-9;

  // Find peaks (skip bin 0 = DC, and very low bins = near-DC noise)
  const minBin = Math.max(2, Math.floor(N / (N / 2))); // at least bin 2
  const peaks = findPeaks(spectrum, minBin);

  if (peaks.length === 0) return empty;

  const dominant = peaks[0];
  const proposedPeriod = N / dominant.bin;
  const peakRatio = dominant.magnitude / (totalEnergy / spectrum.length); // peak vs mean energy
  const harmonicPeakCount = countHarmonics(peaks, dominant.bin);

  // Periodicity energy: sum energy at fundamental + harmonics / total
  let periodicEnergy = dominant.magnitude;
  for (let h = 2; h <= 8; h++) {
    const hBin = Math.round(dominant.bin * h);
    if (hBin < spectrum.length) {
      // Add the strongest spectrum value in the tolerance window around the
      // expected harmonic bin. (Previously a stray `break` ended the loop after
      // the first bin, so only `hBin - tol` was ever inspected instead of the
      // nearest peak across the window.)
      const tol = Math.max(1, Math.round(dominant.bin * 0.15));
      let bestHarmonic = spectrum[hBin];
      for (let b = Math.max(0, hBin - tol); b <= Math.min(spectrum.length - 1, hBin + tol); b++) {
        if (spectrum[b] > bestHarmonic) bestHarmonic = spectrum[b];
      }
      periodicEnergy += bestHarmonic;
    }
  }
  const periodicityEnergy = periodicEnergy / totalEnergy;

  const tileRepeats = N / proposedPeriod;

  // Stage 2: Autocorrelation-validate
  const lag = Math.round(proposedPeriod);
  const autocorrAtPeriod = lag > 0 && lag < N ? autocorrelationAtLag(signal, lag) : 0;

  // Classification for this axis
  const passes =
    peakRatio >= PEAK_RATIO_THRESHOLD &&
    periodicityEnergy >= PERIODICITY_ENERGY_THRESHOLD &&
    harmonicPeakCount >= MIN_HARMONIC_PEAKS &&
    tileRepeats >= MIN_TILE_REPEATS &&
    autocorrAtPeriod >= AUTOCORR_CONFIRM_THRESHOLD;

  return {
    axis,
    peakBin: dominant.bin,
    proposedPeriod,
    peakRatio,
    periodicityEnergy,
    harmonicPeakCount,
    tileRepeats,
    autocorrAtPeriod,
    passes,
  };
}

/**
 * Full repeat detection: FFT-propose + autocorrelation-validate on both axes.
 *
 * @param imageRgba Raw RGBA buffer of the full image.
 * @param width Image width.
 * @param height Image height.
 * @param rasterData Fabric mask (SAM2 raster), same dims. >127 = fabric.
 * @returns Classification result with full diagnostics for calibration.
 */
export function detectRepeat(
  imageRgba: Buffer,
  width: number,
  height: number,
  rasterData: Uint8Array
): RepeatDetectorResult {
  const bb = maskBBox(rasterData, width, height);
  if (!bb || (bb.xmax - bb.xmin) < 16 || (bb.ymax - bb.ymin) < 16) {
    return {
      isAllover: false,
      isBorder: false,
      confidence: 0,
      axes: [],
      classification: "insufficient_data",
    };
  }

  const xSig = axisSignal(imageRgba, width, rasterData, bb, "x");
  const ySig = axisSignal(imageRgba, width, rasterData, bb, "y");

  const xResult = analyzeAxis(xSig, "x");
  const yResult = analyzeAxis(ySig, "y");

  const axes = [xResult, yResult];
  const passingAxes = axes.filter(a => a.passes);

  if (passingAxes.length === 2) {
    // Both axes pass → allover
    const confidence = Math.max(xResult.autocorrAtPeriod, yResult.autocorrAtPeriod);
    return { isAllover: true, isBorder: false, confidence, axes, classification: "allover" };
  }

  if (passingAxes.length === 1) {
    // One axis only → border print (rejected by spec)
    const confidence = passingAxes[0].autocorrAtPeriod;
    return { isAllover: false, isBorder: true, confidence, axes, classification: "border" };
  }

  // Neither axis passes → placement/single
  const confidence = Math.max(xResult.autocorrAtPeriod, yResult.autocorrAtPeriod);
  return { isAllover: false, isBorder: false, confidence, axes, classification: "placement" };
}

/**
 * Compatibility wrapper: same interface as `checkRepeat` from repeatGuard.ts.
 * Uses the advanced FFT+autocorrelation detector internally.
 * Returns `isRepeat: true` only for allover classification.
 */
export function checkRepeatAdvanced(
  imageRgba: Buffer,
  width: number,
  height: number,
  rasterData: Uint8Array
): { isRepeat: boolean; confidence: number; classification: string; axes: AxisDiagnostics[] } {
  const result = detectRepeat(imageRgba, width, height, rasterData);
  return {
    isRepeat: result.isAllover,
    confidence: result.confidence,
    classification: result.classification,
    axes: result.axes,
  };
}
