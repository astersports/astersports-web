/**
 * A1-EVAL metric tests — pure, no I/O.
 * Verify the chroma-at-own-L target metric, the bleed (off-target) metric, and
 * that luminance SSIM is ~1 when L is held (as A1 does).
 */
import { describe, it, expect } from "vitest";
import { computeRecolorMetrics, verdict, ssim } from "./_core/studio/eval/metrics";
import { rgb255ToLab, labToRgb255, hexToLab, deltaE2000 } from "./_core/studio/ops/color";

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

  const FAR = [230, 220, 40]; // yellow — clearly > far(40) ΔE from the blue source

  it("passes all metrics for an ideal L-preserving remap", () => {
    const source = rgba(() => [SRC[0], SRC[1], SRC[2]]);
    const out = rgba(() => [toRgb.r, toRgb.g, toRgb.b]); // a/b -> target, L preserved (same L)
    const m = computeRecolorMetrics(source, out, W, H, FULL, fromColor, toColor);
    expect(m.targetDeltaE).toBeLessThanOrEqual(5);
    expect(m.lumSSIM).toBeGreaterThanOrEqual(0.95);
    expect(m.offTargetBackgroundDeltaE).toBeLessThanOrEqual(2);
    expect(m.offTargetFabricDeltaE).toBeLessThanOrEqual(2);
    expect(verdict(m).pass).toBe(true);
  });

  it("routes nearby-separation pull to FABRIC bleed (op-tuning), not background", () => {
    // Left = target separation; right = a far distinct color, IN fabric, wrongly changed.
    const source = rgba((x) => (x < W / 2 ? (SRC as [number, number, number]) : (FAR as [number, number, number])));
    const out = rgba((x) => (x < W / 2 ? [toRgb.r, toRgb.g, toRgb.b] : [120, 60, 160]));
    const m = computeRecolorMetrics(source, out, W, H, FULL, fromColor, toColor);
    expect(m.offTargetFabricDeltaE).toBeGreaterThan(2);
    expect(m.offTargetBackgroundDeltaE).toBe(0); // no background pixels
    const v = verdict(m);
    expect(v.offFabricPass).toBe(false);
    expect(v.offBackgroundPass).toBe(true);
  });

  it("routes background bleed to BACKGROUND (raster-fixable), not fabric", () => {
    // Right half is background (membership 0) and gets wrongly changed.
    const half = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) half[y * W + x] = x < W / 2 ? 1 : 0;
    const source = rgba((x) => (x < W / 2 ? (SRC as [number, number, number]) : (FAR as [number, number, number])));
    const out = rgba((x) => (x < W / 2 ? [toRgb.r, toRgb.g, toRgb.b] : [120, 60, 160]));
    const m = computeRecolorMetrics(source, out, W, H, half, fromColor, toColor);
    expect(m.offTargetBackgroundDeltaE).toBeGreaterThan(2);
    expect(m.offTargetFabricDeltaE).toBe(0); // no far-from-source fabric pixels
    const v = verdict(m);
    expect(v.offBackgroundPass).toBe(false);
    expect(v.offFabricPass).toBe(true);
  });

  it("excludes the intended soft-edge band from both off-target metrics", () => {
    // A mid-band color (near < ΔE <= far from fromColor) that the op changed must
    // be scored by neither metric.
    const near = 10, far = 60;
    const bandRgb = labToRgb255({ l: srcLab.l, a: srcLab.a + 22, b: srcLab.b - 22 });
    const band = [bandRgb.r, bandRgb.g, bandRgb.b];
    const source = rgba((x) => (x < W / 2 ? (SRC as [number, number, number]) : (band as [number, number, number])));
    const out = rgba((x) => (x < W / 2 ? [toRgb.r, toRgb.g, toRgb.b] : [120, 60, 160]));
    const m = computeRecolorMetrics(source, out, W, H, FULL, fromColor, toColor, { near, far });
    // Confirm the band color actually lands in (near, far) so the test is meaningful.
    const dFrom = deltaE2000(rgb255ToLab(band[0], band[1], band[2]), hexToLab(fromColor));
    expect(dFrom).toBeGreaterThan(near);
    expect(dFrom).toBeLessThanOrEqual(far);
    expect(m.bandCount).toBe((W / 2) * H);
    expect(m.offTargetFabricDeltaE).toBe(0);
    expect(m.offTargetBackgroundDeltaE).toBe(0);
  });

  it("fails luminance when L is not preserved", () => {
    const source = rgba(() => [SRC[0], SRC[1], SRC[2]]);
    const out = rgba(() => [10, 10, 10]); // L collapses -> SSIM drops
    const m = computeRecolorMetrics(source, out, W, H, FULL, fromColor, toColor);
    expect(m.lumSSIM).toBeLessThan(0.95);
  });
});
