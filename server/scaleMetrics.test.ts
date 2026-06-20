/**
 * Scale eval-metric tests. Synthetic periodic grids (op-agnostic — the metric
 * scores two images, it does not run the op). Both scale directions (R3), the
 * area fallback, and the poseBg-excluded-from-pass rule.
 */
import { describe, it, expect } from "vitest";
import { computeScaleMetrics, scaleVerdict } from "./_core/studio/eval/scaleMetrics";

const W = 96, H = 96;

/** Dot grid: motifs of radius R on period P, motif color fg over base cloth bg. */
function grid(P: number, R: number, fg: number[], bg: number[]): Buffer {
  const b = Buffer.alloc(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const cx = Math.round(x / P) * P, cy = Math.round(y / P) * P;
      const dot = (x - cx) ** 2 + (y - cy) ** 2 <= R * R;
      const c = dot ? fg : bg;
      const p = (y * W + x) * 4;
      b[p] = c[0]; b[p + 1] = c[1]; b[p + 2] = c[2]; b[p + 3] = 255;
    }
  }
  return b;
}

const FG = [200, 80, 90], BG = [230, 225, 210];
const FULL = new Uint8Array(W * H).fill(1);

describe("computeScaleMetrics — repeat period (R3 primary)", () => {
  it("measures a shrink (period 16 -> 8 ~ fraction 0.5)", () => {
    const m = computeScaleMetrics({
      source: grid(16, 5, FG, BG), out: grid(8, 3, FG, BG),
      width: W, height: H, truthMask: FULL, targetFraction: 0.5,
    });
    expect(m.estimator).toBe("period");
    expect(Math.abs(m.measuredFraction - 0.5)).toBeLessThan(0.1);
    expect(m.scaleRatioError).toBeLessThanOrEqual(0.15);
    expect(scaleVerdict(m).ratioPass).toBe(true);
  });

  it("measures an enlarge (period 16 -> 24 ~ fraction 1.5)", () => {
    const m = computeScaleMetrics({
      source: grid(16, 5, FG, BG), out: grid(24, 7, FG, BG),
      width: W, height: H, truthMask: FULL, targetFraction: 1.5,
    });
    expect(m.estimator).toBe("period");
    expect(Math.abs(m.measuredFraction - 1.5)).toBeLessThan(0.2);
    expect(scaleVerdict(m).pass).toBe(true);
  });

  it("flags a wrong-magnitude scale (period barely changed vs target 0.5)", () => {
    const m = computeScaleMetrics({
      source: grid(16, 5, FG, BG), out: grid(15, 5, FG, BG),
      width: W, height: H, truthMask: FULL, targetFraction: 0.5,
    });
    expect(m.scaleRatioError).toBeGreaterThan(0.15);
    expect(scaleVerdict(m).ratioPass).toBe(false);
  });

  it("preserves the palette (same inks, resized)", () => {
    const m = computeScaleMetrics({
      source: grid(16, 5, FG, BG), out: grid(8, 3, FG, BG),
      width: W, height: H, truthMask: FULL, targetFraction: 0.5,
    });
    expect(m.paletteDeltaE).toBeLessThanOrEqual(5);
  });

  it("is deterministic", () => {
    const inp = {
      source: grid(16, 5, FG, BG), out: grid(8, 3, FG, BG),
      width: W, height: H, truthMask: FULL, targetFraction: 0.5,
    };
    expect(computeScaleMetrics(inp)).toEqual(computeScaleMetrics(inp));
  });
});

describe("computeScaleMetrics — area fallback (R3)", () => {
  it("falls back to motif-area-ratio when the period is unreliable", () => {
    const flat = Buffer.alloc(W * H * 4);
    for (let i = 0; i < W * H; i++) { const p = i * 4; flat[p] = 220; flat[p + 1] = 215; flat[p + 2] = 205; flat[p + 3] = 255; }
    const m = computeScaleMetrics({
      source: flat, out: Buffer.from(flat), width: W, height: H, truthMask: FULL,
      targetFraction: 0.5,
      areaFallback: { sourceMeanArea: 100, outMeanArea: 25 }, // linear fraction = sqrt(25/100) = 0.5
    });
    expect(m.estimator).toBe("area");
    expect(Math.abs(m.measuredFraction - 0.5)).toBeLessThan(0.01);
    expect(scaleVerdict(m).ratioPass).toBe(true);
  });
});

describe("computeScaleMetrics — poseBg is the mask signal, excluded from pass", () => {
  it("background bleed fails poseBg but does NOT fail the A1-style op verdict", () => {
    // top half = fabric (truth 1), bottom half = background (truth 0).
    const mask = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) mask[y * W + x] = y < H / 2 ? 1 : 0;
    const source = grid(16, 5, FG, BG);
    const out = grid(16, 5, FG, BG);
    // corrupt the background (bottom) in `out` only -> pose/background bleed.
    for (let y = H / 2; y < H; y++) for (let x = 0; x < W; x++) {
      const p = (y * W + x) * 4; out[p] = 30; out[p + 1] = 60; out[p + 2] = 160;
    }
    const m = computeScaleMetrics({
      source, out, width: W, height: H, truthMask: mask, targetFraction: 1.0,
    });
    const v = scaleVerdict(m);
    expect(m.poseBgDeltaE).toBeGreaterThan(2);
    expect(v.poseBgPass).toBe(false);
    expect(v.pass).toBe(true); // op correctness holds; background is the D1/mask call
  });
});
