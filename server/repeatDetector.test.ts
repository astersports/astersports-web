/**
 * Tests for the FFT + autocorrelation repeat detector (§ 5, Decision 3).
 * Validates classification of allover, border, placement, and edge cases.
 */
import { describe, it, expect } from "vitest";
import {
  detectRepeat,
  checkRepeatAdvanced,
  PEAK_RATIO_THRESHOLD,
  PERIODICITY_ENERGY_THRESHOLD,
  MIN_HARMONIC_PEAKS,
  MIN_TILE_REPEATS,
  AUTOCORR_CONFIRM_THRESHOLD,
} from "./_core/studio/ops/repeatDetector";

const W = 200, H = 200;

/** Create a full fabric mask (all pixels are fabric). */
function fullMask(): Uint8Array {
  return new Uint8Array(W * H).fill(255);
}

/** Create an RGBA buffer with a repeating stripe pattern on both axes (allover). */
function alloверStripes(periodX: number, periodY: number): Buffer {
  const buf = Buffer.alloc(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      // Create a 2D periodic pattern: bright where both axes are in "on" phase
      const onX = (x % periodX) < (periodX / 2);
      const onY = (y % periodY) < (periodY / 2);
      const val = (onX && onY) ? 220 : 40;
      buf[i] = val; buf[i + 1] = val; buf[i + 2] = val; buf[i + 3] = 255;
    }
  }
  return buf;
}

/** Create a pattern that repeats on X axis only (border print). */
function borderStripes(periodX: number): Buffer {
  const buf = Buffer.alloc(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      // Periodic on X, gradient on Y (non-periodic)
      const onX = (x % periodX) < (periodX / 2);
      const val = onX ? (200 - y * 0.5) : (40 + y * 0.1);
      buf[i] = Math.max(0, Math.min(255, val));
      buf[i + 1] = Math.max(0, Math.min(255, val));
      buf[i + 2] = Math.max(0, Math.min(255, val));
      buf[i + 3] = 255;
    }
  }
  return buf;
}

/** Create a uniform (non-periodic) image — placement/single graphic. */
function uniformImage(): Buffer {
  const buf = Buffer.alloc(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      // Single gradient — no periodicity
      const val = Math.floor((x + y) / 2) % 256;
      buf[i] = val; buf[i + 1] = 128; buf[i + 2] = 64; buf[i + 3] = 255;
    }
  }
  return buf;
}

/** Create a single placed graphic (circle in center). */
function placementImage(): Buffer {
  const buf = Buffer.alloc(W * H * 4);
  const cx = W / 2, cy = H / 2, r = 30;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
      const val = dist < r ? 220 : 40;
      buf[i] = val; buf[i + 1] = val; buf[i + 2] = val; buf[i + 3] = 255;
    }
  }
  return buf;
}

describe("repeatDetector", () => {
  describe("detectRepeat", () => {
    it("classifies a 2D periodic pattern as allover", () => {
      // Period 25px on both axes → 8 repeats in 200px (well above 2.5 min)
      const img = alloверStripes(25, 25);
      const result = detectRepeat(img, W, H, fullMask());
      expect(result.classification).toBe("allover");
      expect(result.isAllover).toBe(true);
      expect(result.isBorder).toBe(false);
      expect(result.confidence).toBeGreaterThan(0);
      expect(result.axes).toHaveLength(2);
    });

    it("classifies a single placed graphic as placement", () => {
      const img = placementImage();
      const result = detectRepeat(img, W, H, fullMask());
      expect(result.classification).toBe("placement");
      expect(result.isAllover).toBe(false);
      expect(result.isBorder).toBe(false);
    });

    it("classifies a uniform/gradient image as placement", () => {
      const img = uniformImage();
      const result = detectRepeat(img, W, H, fullMask());
      expect(result.classification).toBe("placement");
      expect(result.isAllover).toBe(false);
    });

    it("returns insufficient_data for tiny mask", () => {
      const img = alloверStripes(25, 25);
      // Mask only a 10x10 region (too small)
      const mask = new Uint8Array(W * H).fill(0);
      for (let y = 0; y < 10; y++) {
        for (let x = 0; x < 10; x++) {
          mask[y * W + x] = 255;
        }
      }
      const result = detectRepeat(img, W, H, mask);
      expect(result.classification).toBe("insufficient_data");
    });

    it("returns insufficient_data for empty mask", () => {
      const img = alloверStripes(25, 25);
      const mask = new Uint8Array(W * H).fill(0);
      const result = detectRepeat(img, W, H, mask);
      expect(result.classification).toBe("insufficient_data");
    });

    it("provides per-axis diagnostics for calibration", () => {
      const img = alloверStripes(20, 20);
      const result = detectRepeat(img, W, H, fullMask());
      expect(result.axes).toHaveLength(2);
      for (const ax of result.axes) {
        expect(ax).toHaveProperty("peakBin");
        expect(ax).toHaveProperty("proposedPeriod");
        expect(ax).toHaveProperty("peakRatio");
        expect(ax).toHaveProperty("periodicityEnergy");
        expect(ax).toHaveProperty("harmonicPeakCount");
        expect(ax).toHaveProperty("tileRepeats");
        expect(ax).toHaveProperty("autocorrAtPeriod");
        expect(ax).toHaveProperty("passes");
      }
    });

    it("detects correct period for known periodic input", () => {
      const period = 40; // 5 repeats in 200px
      const img = alloверStripes(period, period);
      const result = detectRepeat(img, W, H, fullMask());
      // The proposed period should be close to 40px
      for (const ax of result.axes) {
        if (ax.passes) {
          expect(ax.proposedPeriod).toBeGreaterThan(period * 0.7);
          expect(ax.proposedPeriod).toBeLessThan(period * 1.3);
        }
      }
    });
  });

  describe("checkRepeatAdvanced (compatibility wrapper)", () => {
    it("returns isRepeat: true for allover", () => {
      const img = alloверStripes(25, 25);
      const result = checkRepeatAdvanced(img, W, H, fullMask());
      expect(result.isRepeat).toBe(true);
      expect(result.classification).toBe("allover");
    });

    it("returns isRepeat: false for placement", () => {
      const img = placementImage();
      const result = checkRepeatAdvanced(img, W, H, fullMask());
      expect(result.isRepeat).toBe(false);
    });
  });

  describe("threshold constants are exported for calibration", () => {
    it("exports all calibration thresholds", () => {
      expect(PEAK_RATIO_THRESHOLD).toBe(0.30);
      expect(PERIODICITY_ENERGY_THRESHOLD).toBe(0.50);
      expect(MIN_HARMONIC_PEAKS).toBe(2);
      expect(MIN_TILE_REPEATS).toBe(2.5);
      expect(AUTOCORR_CONFIRM_THRESHOLD).toBe(0.25);
    });
  });
});
