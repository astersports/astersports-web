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
 *      - peakRatio: magnitude of dominant non-DC peak / mean spectral energy
 *        (peak ÷ mean-of-spectrum; NOT peak ÷ DC — DC is centered out)
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

/** Minimum peak-to-mean-energy ratio in the power spectrum to propose a period. */
export const PEAK_RATIO_THRESHOLD = 0.30;

/** Minimum fraction of spectral energy in periodic peaks. */
export const PERIODICITY_ENERGY_THRESHOLD = 0.50;

/** Minimum number of evenly-spaced harmonic peaks per axis. */
export const MIN_HARMONIC_PEAKS = 2;

/** Minimum tile repeats along an axis (signal length / period). */
export const MIN_TILE_REPEATS = 2.5;

/** Autocorrelation confirmation threshold for the FFT-proposed period. */
export const AUTOCORR_CONFIRM_THRESHOLD = 0.25;

// ─── All-over COVERAGE path (the scattered-print reframe) ────────────────────
// Strategy §1/P2: a tossed/scattered print has NO strict period, so the FFT path
// false-rejects it (~⅓ of genuine repeats). Scale should treat "all-over scattered
// COVERAGE" as scalable (resize motifs, don't re-tile a period). This second
// acceptance path classifies coverage from the SPATIAL DISTRIBUTION of motif blobs:
// many small components, spread across the fabric in 2D = all-over → ACCEPT; a single
// big blob (placement) or a few full-span strips (border) = REJECT. These are
// calibration starting points, not frozen.

/** Lab distance from estimated ground above which a pixel is "motif" (foreground). */
export const ALLOVER_FG_TAU = 12;
/** Foreground coverage band: below = empty/solid; above = a single near-full fill. */
export const ALLOVER_FRAC_LO = 0.012;
export const ALLOVER_FRAC_HI = 0.96;
/** Minimum distinct motif components (rejects a single placed graphic). */
export const ALLOVER_MIN_MOTIFS = 2;
/** Minimum occupancy of a 5×5 grid over the fabric bbox (foreground spreads, not clusters). */
export const ALLOVER_MIN_OCCUPANCY = 0.60;
/** A grid cell counts as occupied when its foreground fraction exceeds this. */
export const ALLOVER_CELL_EPS = 0.008;
/** Mean L-gradient floor — a print has high-frequency motif EDGES; a smooth gradient
 *  or solid does not. Rejects gradients/solids whose pixels drift far from the median
 *  without any actual motif texture (the "gradient looks all-over" trap). */
export const ALLOVER_EDGE_MIN = 0.4;
/** All-over print must put foreground in ≥ (GRID−1) distinct grid rows AND columns (2D spread). */
const ALLOVER_GRID = 5;
export const ALLOVER_MIN_GRID_AXIS = ALLOVER_GRID - 1;

// ─── Types ──────────────────────────────────────────────────────────────────

export interface AxisDiagnostics {
  axis: "x" | "y";
  /** Dominant non-DC peak frequency (bin index). */
  peakBin: number;
  /** Proposed period in pixels (signal_length / peakBin). */
  proposedPeriod: number;
  /** Peak-to-mean-energy ratio (dominant peak magnitude ÷ mean spectral energy). */
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
  /** Which path accepted: "periodic" (FFT) or "coverage" (scattered) or null if rejected. */
  acceptPath?: "periodic" | "coverage" | null;
  /** All-over coverage diagnostics (the scattered-print path). */
  coverage?: AlloverCoverage;
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

// ─── All-over coverage analysis (scattered-print acceptance) ────────────────

export interface AlloverCoverage {
  isAllover: boolean;
  /** Foreground (motif) fraction within the fabric bbox. */
  foregroundFrac: number;
  /** Distinct motif components after noise filtering. */
  numMotifs: number;
  /** Occupied fraction of the 5×5 grid over the bbox. */
  occupancy: number;
  /** Median component span max(w,h)/bbox (small = compact motifs, large = strips). */
  medianSpan: number;
  /** Mean L-gradient over the bbox (texture/edge energy; smooth gradients ≈ 0). */
  edgeEnergy: number;
}

/** Median of L,a,b over (sampled) masked pixels → estimated ground colour. */
function groundLab(buf: Buffer, w: number, mask: Uint8Array, bb: BBox): [number, number, number] {
  const Ls: number[] = [], As: number[] = [], Bs: number[] = [];
  for (let y = bb.ymin; y <= bb.ymax; y++) for (let x = bb.xmin; x <= bb.xmax; x++) {
    const i = y * w + x;
    if (mask[i] <= 127 || (x + y) % 2) continue;
    const lab = rgb255ToLab(buf[i * 4], buf[i * 4 + 1], buf[i * 4 + 2]);
    Ls.push(lab.l); As.push(lab.a); Bs.push(lab.b);
  }
  const med = (a: number[]) => { if (!a.length) return 0; const s = [...a].sort((p, q) => p - q); return s[s.length >> 1]; };
  return [med(Ls), med(As), med(Bs)];
}

/**
 * Classify all-over scattered COVERAGE from motif blob distribution. 4-connectivity
 * so corner-touching motifs (e.g. checkerboards, dense dots) stay distinct; a full
 * fabric strip (border) stays one elongated component and is rejected by the span gate.
 */
function analyzeAllover(buf: Buffer, w: number, h: number, mask: Uint8Array, bb: BBox): AlloverCoverage {
  const bw = bb.xmax - bb.xmin + 1, bh = bb.ymax - bb.ymin + 1;
  const bboxArea = bw * bh;
  const [gl, ga, gb] = groundLab(buf, w, mask, bb);

  // Foreground = far-from-ground masked pixels; also accumulate L-gradient (edge energy)
  // so a smooth gradient/solid — whose pixels can drift "far from median" without any
  // motif texture — is rejected (it is not an all-over PRINT).
  const fg = new Uint8Array(w * h);
  let maskCount = 0, fgCount = 0, gradSum = 0, gradN = 0;
  for (let y = bb.ymin; y <= bb.ymax; y++) for (let x = bb.xmin; x <= bb.xmax; x++) {
    const i = y * w + x;
    if (mask[i] <= 127) continue;
    maskCount++;
    const lab = rgb255ToLab(buf[i * 4], buf[i * 4 + 1], buf[i * 4 + 2]);
    if (Math.hypot(lab.l - gl, lab.a - ga, lab.b - gb) > ALLOVER_FG_TAU) { fg[i] = 1; fgCount++; }
    if (x < bb.xmax && y < bb.ymax && mask[i + 1] > 127 && mask[i + w] > 127) {
      gradSum += Math.abs(lum(buf, i + 1) - lab.l) + Math.abs(lum(buf, i + w) - lab.l); gradN++;
    }
  }
  const foregroundFrac = maskCount ? fgCount / maskCount : 0;
  const edgeEnergy = gradN ? gradSum / gradN : 0;
  const empty: AlloverCoverage = { isAllover: false, foregroundFrac, numMotifs: 0, occupancy: 0, medianSpan: 1, edgeEnergy };
  if (foregroundFrac < ALLOVER_FRAC_LO || foregroundFrac > ALLOVER_FRAC_HI) return empty;
  if (edgeEnergy < ALLOVER_EDGE_MIN) return empty; // smooth gradient / solid — not a print

  // Connected components (4-conn), iterative flood fill, restricted to bbox.
  const minCompPx = Math.max(4, Math.floor(0.00004 * bboxArea));
  const labels = new Int32Array(w * h).fill(-1);
  const comps: { area: number; minx: number; maxx: number; miny: number; maxy: number }[] = [];
  const stack: number[] = [];
  for (let y = bb.ymin; y <= bb.ymax; y++) for (let x = bb.xmin; x <= bb.xmax; x++) {
    const s = y * w + x;
    if (!fg[s] || labels[s] !== -1) continue;
    labels[s] = comps.length; stack.length = 0; stack.push(s);
    const c = { area: 0, minx: w, maxx: 0, miny: h, maxy: 0 };
    while (stack.length) {
      const p = stack.pop()!; const px = p % w, py = (p / w) | 0;
      c.area++;
      if (px < c.minx) c.minx = px; if (px > c.maxx) c.maxx = px;
      if (py < c.miny) c.miny = py; if (py > c.maxy) c.maxy = py;
      const nb = [p - 1, p + 1, p - w, p + w];
      const nx = [px - 1, px + 1, px, px], ny = [py, py, py - 1, py + 1];
      for (let k = 0; k < 4; k++) {
        const X = nx[k], Y = ny[k];
        if (X < bb.xmin || X > bb.xmax || Y < bb.ymin || Y > bb.ymax) continue;
        const q = nb[k];
        if (fg[q] && labels[q] === -1) { labels[q] = labels[s]; stack.push(q); }
      }
    }
    comps.push(c);
  }

  const kept = comps.filter((c) => c.area >= minCompPx);
  const numMotifs = kept.length;
  if (numMotifs === 0) return { ...empty, numMotifs: 0 };

  // Occupancy from FOREGROUND PIXELS over a 5×5 grid: a cell is occupied when its
  // foreground fraction exceeds CELL_EPS. This generalizes across SPARSE scatter
  // (a dot per cell) and DENSE all-over (most of every cell) — both fill the grid —
  // while a localized placement blob lights only the central cells. Border strips are
  // already caught by the FFT one-axis path (coverage runs only when 0 axes pass).
  const cellFg = new Float64Array(ALLOVER_GRID * ALLOVER_GRID);
  const cellTot = new Float64Array(ALLOVER_GRID * ALLOVER_GRID);
  for (let y = bb.ymin; y <= bb.ymax; y++) for (let x = bb.xmin; x <= bb.xmax; x++) {
    const i = y * w + x;
    if (mask[i] <= 127) continue;
    const gx = Math.min(ALLOVER_GRID - 1, Math.floor(((x - bb.xmin) / bw) * ALLOVER_GRID));
    const gy = Math.min(ALLOVER_GRID - 1, Math.floor(((y - bb.ymin) / bh) * ALLOVER_GRID));
    const gi = gy * ALLOVER_GRID + gx;
    cellTot[gi]++; if (fg[i]) cellFg[gi]++;
  }
  const activeRows = new Set<number>(), activeCols = new Set<number>();
  let occupied = 0, cells = 0;
  for (let gy = 0; gy < ALLOVER_GRID; gy++) for (let gx = 0; gx < ALLOVER_GRID; gx++) {
    const gi = gy * ALLOVER_GRID + gx;
    if (cellTot[gi] <= 0) continue; // cell has no fabric (irregular mask) — ignore
    cells++;
    if (cellFg[gi] / cellTot[gi] > ALLOVER_CELL_EPS) { occupied++; activeRows.add(gy); activeCols.add(gx); }
  }
  const occupancy = cells ? occupied / cells : 0;
  // Real median component span (max(w,h)/bbox). No longer gates (FFT handles borders),
  // but reported for calibration/debugging so the diagnostic isn't misleading.
  const spans = kept
    .map((c) => Math.max((c.maxx - c.minx + 1) / bw, (c.maxy - c.miny + 1) / bh))
    .sort((a, b) => a - b);
  const medianSpan = spans.length ? spans[spans.length >> 1] : 0;

  const isAllover =
    numMotifs >= ALLOVER_MIN_MOTIFS &&
    occupancy >= ALLOVER_MIN_OCCUPANCY &&
    activeRows.size >= ALLOVER_MIN_GRID_AXIS &&
    activeCols.size >= ALLOVER_MIN_GRID_AXIS;

  return { isAllover, foregroundFrac, numMotifs, occupancy, medianSpan, edgeEnergy };
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

  // PATH 1 — periodic (FFT both axes): a strict geometric repeat → allover.
  if (passingAxes.length === 2) {
    const confidence = Math.max(xResult.autocorrAtPeriod, yResult.autocorrAtPeriod);
    return { isAllover: true, isBorder: false, confidence, axes, classification: "allover", acceptPath: "periodic" };
  }

  // PATH 1.5 — periodic on exactly ONE axis → border print (rejected). The FFT is the
  // reliable border guard (full-width/height strips), so we resolve borders here and do
  // NOT let the coverage path override them.
  if (passingAxes.length === 1) {
    const confidence = passingAxes[0].autocorrAtPeriod;
    const coverage = analyzeAllover(imageRgba, width, height, rasterData, bb); // diag only
    return { isAllover: false, isBorder: true, confidence, axes, classification: "border", acceptPath: null, coverage };
  }

  // PATH 2 — all-over scattered COVERAGE (the reframe). Reached only when the FFT found
  // NO periodic axis — i.e. the cases the old detector blanket-rejected as "placement".
  // A tossed/scattered print (no strict period) whose motifs spread across the fabric in
  // 2D is scalable by motif-RESIZE (§1/P2); a single placed graphic is not. Coverage
  // separates them by foreground grid-occupancy + 2D spread.
  const coverage = analyzeAllover(imageRgba, width, height, rasterData, bb);
  if (coverage.isAllover) {
    const confidence = Math.max(coverage.occupancy, xResult.autocorrAtPeriod, yResult.autocorrAtPeriod);
    return { isAllover: true, isBorder: false, confidence, axes, classification: "allover", acceptPath: "coverage", coverage };
  }

  // Neither path → placement/single (rejected).
  const confidence = Math.max(xResult.autocorrAtPeriod, yResult.autocorrAtPeriod);
  return { isAllover: false, isBorder: false, confidence, axes, classification: "placement", acceptPath: null, coverage };
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
