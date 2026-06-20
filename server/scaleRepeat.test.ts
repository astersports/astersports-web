/**
 * Scale op v1 tests. Synthetic periodic raster (dot grid as "print" inside a
 * rectangular fabric mask, with a notched-silhouette variant). decodeUpright is
 * mocked. Period/palette are asserted via the landed scaleMetrics module.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./_core/image/decodeUpright", () => ({ decodeUpright: vi.fn() }));
import { decodeUpright } from "./_core/image/decodeUpright";
import { scalePrintRepeat } from "./_core/studio/ops/scaleRepeat";
import { computeScaleMetrics, scaleVerdict } from "./_core/studio/eval/scaleMetrics";
import type { FabricMask, RasterMask } from "./_core/masking/types";

const mockDecode = decodeUpright as unknown as ReturnType<typeof vi.fn>;
const W = 96, H = 96, P = 16, R = 4;
const BG = [225, 220, 205], FG = [200, 80, 90];
const M0 = 16, M1 = 80; // fabric rect [16..79]

/** Base cloth + period-P dot grid across the whole image. */
function scene(): Buffer {
  const b = Buffer.alloc(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const cx = Math.round(x / P) * P, cy = Math.round(y / P) * P;
      const c = (x - cx) ** 2 + (y - cy) ** 2 <= R * R ? FG : BG;
      const p = (y * W + x) * 4;
      b[p] = c[0]; b[p + 1] = c[1]; b[p + 2] = c[2]; b[p + 3] = 255;
    }
  }
  return b;
}

function rectRaster(notch = false): RasterMask {
  const data = new Uint8Array(W * H);
  for (let y = M0; y < M1; y++) for (let x = M0; x < M1; x++) {
    if (notch && x >= 56 && y >= 56) continue; // bottom-right notch
    data[y * W + x] = 255;
  }
  return { width: W, height: H, data };
}

const fabric = (notch = false): FabricMask => ({
  bbox: { x: M0 / W, y: M0 / H, w: (M1 - M0) / W, h: (M1 - M0) / H }, confidence: 1, provider: "sam2", raster: rectRaster(notch),
});
const maskU1 = (notch = false) => Uint8Array.from(rectRaster(notch).data, (v) => (v > 127 ? 1 : 0));

beforeEach(() => { mockDecode.mockImplementation(async () => ({ buffer: scene(), width: W, height: H })); });

function borderIdentical(out: Buffer, input: Buffer): boolean {
  const b = 12;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!(x < b || x >= W - b || y < b || y >= H - b)) continue;
    const p = (y * W + x) * 4;
    if (out[p] !== input[p] || out[p + 1] !== input[p + 1] || out[p + 2] !== input[p + 2]) return false;
  }
  return true;
}

describe("scalePrintRepeat", () => {
  it("shrinks the repeat to ~0.5 (smaller period), palette preserved, garment frozen", async () => {
    const { data: out } = await scalePrintRepeat({ image: { url: "x" }, fabric: fabric(), targetFraction: 0.5 });
    const m = computeScaleMetrics({ source: scene(), out, width: W, height: H, truthMask: maskU1(), targetFraction: 0.5 });
    expect(m.scaleRatioError).toBeLessThanOrEqual(0.15);
    expect(m.paletteDeltaE).toBeLessThanOrEqual(5);
    expect(scaleVerdict(m).pass).toBe(true);
    expect(borderIdentical(out, scene())).toBe(true);
  });

  it("enlarges the repeat to ~1.3 (larger period)", async () => {
    const { data: out } = await scalePrintRepeat({ image: { url: "x" }, fabric: fabric(), targetFraction: 1.3 });
    const m = computeScaleMetrics({ source: scene(), out, width: W, height: H, truthMask: maskU1(), targetFraction: 1.3 });
    expect(m.scaleRatioError).toBeLessThanOrEqual(0.15);
    expect(m.paletteDeltaE).toBeLessThanOrEqual(5);
    expect(borderIdentical(out, scene())).toBe(true);
  });

  it("fraction == 1 is a passthrough (in-mask ~= input)", async () => {
    const { data: out } = await scalePrintRepeat({ image: { url: "x" }, fabric: fabric(), targetFraction: 1 });
    const input = scene();
    const mask = maskU1();
    let maxDiff = 0;
    for (let i = 0; i < W * H; i++) if (mask[i]) { const p = i * 4; maxDiff = Math.max(maxDiff, Math.abs(out[p] - input[p])); }
    expect(maxDiff).toBeLessThanOrEqual(2);
  });

  it("respects a notched silhouette (masked-out notch keeps the original)", async () => {
    const { data: out } = await scalePrintRepeat({ image: { url: "x" }, fabric: fabric(true), targetFraction: 0.5 });
    const input = scene();
    // a pixel inside the notch (masked 0) must be untouched
    const p = (70 * W + 70) * 4;
    expect([out[p], out[p + 1], out[p + 2]]).toEqual([input[p], input[p + 1], input[p + 2]]);
  });

  it("is deterministic (identical bytes across runs)", async () => {
    const a = (await scalePrintRepeat({ image: { url: "x" }, fabric: fabric(), targetFraction: 0.5 })).data;
    const b = (await scalePrintRepeat({ image: { url: "x" }, fabric: fabric(), targetFraction: 0.5 })).data;
    expect(Buffer.compare(a, b)).toBe(0);
  });

  it("throws a clear error when fabric.raster is absent", async () => {
    await expect(
      scalePrintRepeat({ image: { url: "x" }, fabric: { bbox: { x: 0, y: 0, w: 1, h: 1 }, confidence: 1, provider: "classical" }, targetFraction: 0.5 })
    ).rejects.toThrow(/raster/);
  });
});
