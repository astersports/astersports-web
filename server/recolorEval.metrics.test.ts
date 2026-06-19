/**
 * A1-EVAL metric tests — pure, no I/O.
 * Verify the chroma-at-own-L target metric, the bleed (off-target) metric, and
 * that luminance SSIM is ~1 when L is held (as A1 does).
 */
import { describe, it, expect } from "vitest";
import { computeRecolorMetrics, verdict, ssim } from "./_core/studio/eval/metrics";
import { rgb255ToLab, labToRgb255, hexToLab } from "./_core/studio/ops/color";

const W = 32, H = 32;

/** Build an RGBA buffer from a per-pixel color function. */
function rgba(fn: (x: number, y: number) => [number, number, number]): Buffer {
  const buf = Buffer.alloc(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const [r, g, b] = fn(x, y);
      const p = (y * W + x) * 4;
      buf[p] = r; buf[p + 1] = g; buf[p + 2] = b; buf[p + 3] = 255;
    }
  }
  return buf;
}

const FULL = new Uint8Array(W * H).fill(1);

describe("ssim", () => {
  it("is 1 for identical signals", () => {
    expect(ssim([1, 2, 3, 4], [1, 2, 3, 4])).toBeCloseTo(1, 6);
  });
  it("returns 1 for empty input", () => {
    expect(ssim([], [])).toBe(1);
  });
});

describe("computeRecolorMetrics", () => {
  const SRC = [40, 90, 120];                 // source separation
  const fromColor = "rgb(40, 90, 120)";
  // Target shares the source's L (A1 preserves L), so a correct remap lands on it.
  const srcLab = rgb255ToLab(SRC[0], SRC[1], SRC[2]);
  const toLab = { l: srcLab.l, a: 45, b: 25 };
  const toRgb = labToRgb255(toLab);
  const toColor = `rgb(${toRgb.r}, ${toRgb.g}, ${toRgb.b})`;

  it("passes all three metrics for an ideal L-preserving remap", () => {
    const source = rgba(() => [SRC[0], SRC[1], SRC[2]]);
    const out = rgba(() => [toRgb.r, toRgb.g, toRgb.b]); // a/b -> target, L preserved (same L)
    const m = computeRecolorMetrics(source, out, W, H, FULL, fromColor, toColor);
    expect(m.targetDeltaE).toBeLessThanOrEqual(5);
    expect(m.lumSSIM).toBeGreaterThanOrEqual(0.95);
    expect(m.offTargetDeltaE).toBeLessThanOrEqual(2);
    expect(verdict(m).pass).toBe(true);
  });

  it("flags bleed: an off-target color that changed raises off-target ΔE", () => {
    // Left half = target separation, right half = a far-off color that we corrupt in `out`.
    const OFF = [60, 140, 70];
    const source = rgba((x) => (x < W / 2 ? (SRC as [number, number, number]) : (OFF as [number, number, number])));
    const out = rgba((x) => {
      if (x < W / 2) return [toRgb.r, toRgb.g, toRgb.b];
      return [120, 60, 160]; // off-target pixels wrongly changed -> bleed
    });
    const m = computeRecolorMetrics(source, out, W, H, FULL, fromColor, toColor);
    expect(m.offTargetDeltaE).toBeGreaterThan(2);
    expect(verdict(m).offPass).toBe(false);
  });

  it("fails luminance when L is not preserved", () => {
    const source = rgba(() => [SRC[0], SRC[1], SRC[2]]);
    // Push everything dark -> L collapses -> SSIM drops.
    const out = rgba(() => [10, 10, 10]);
    const m = computeRecolorMetrics(source, out, W, H, FULL, fromColor, toColor);
    expect(m.lumSSIM).toBeLessThan(0.95);
  });

  it("counts background (membership 0) into the off-target/bleed set", () => {
    const half = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) half[y * W + x] = x < W / 2 ? 1 : 0;
    const source = rgba(() => [SRC[0], SRC[1], SRC[2]]);
    const out = rgba(() => [SRC[0], SRC[1], SRC[2]]); // nothing changed
    const m = computeRecolorMetrics(source, out, W, H, half, fromColor, toColor);
    expect(m.fabricCount).toBe((W / 2) * H);
    expect(m.offTargetDeltaE).toBeCloseTo(0, 5);
  });
});
