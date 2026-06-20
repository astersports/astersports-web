/**
 * A1 tests — deterministic separation remap.
 * Color math + k-means determinism + the three acceptance metrics on a synthetic
 * two-color swatch. decodeUpright is mocked so no network/storage is touched.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import sharp from "sharp";

// Mock the decode boundary: the op receives our synthetic raw RGBA directly.
vi.mock("./_core/image/decodeUpright", () => ({
  decodeUpright: vi.fn(),
}));
import { decodeUpright } from "./_core/image/decodeUpright";
import { separationRemap } from "./_core/studio/ops/separationRemap";
import { rgb255ToLab, labToRgb255, hexToLab, deltaE2000 } from "./_core/studio/ops/color";
import { kmeans, type Vec3 } from "./_core/studio/ops/kmeans";
import type { FabricMask } from "./_core/masking";

const mockDecode = decodeUpright as unknown as ReturnType<typeof vi.fn>;

const FULL_FABRIC: FabricMask = {
  bbox: { x: 0, y: 0, w: 1, h: 1 },
  confidence: 1,
  provider: "classical",
};

describe("color", () => {
  it("round-trips sRGB -> LAB -> sRGB within a couple of units", () => {
    const lab = rgb255ToLab(40, 90, 120);
    const rgb = labToRgb255(lab);
    expect(Math.abs(rgb.r - 40)).toBeLessThanOrEqual(2);
    expect(Math.abs(rgb.g - 90)).toBeLessThanOrEqual(2);
    expect(Math.abs(rgb.b - 120)).toBeLessThanOrEqual(2);
  });

  it("deltaE2000 of identical colors is 0", () => {
    const lab = hexToLab("#3366cc");
    expect(deltaE2000(lab, lab)).toBeCloseTo(0, 6);
  });

  it("parses white to L=100", () => {
    expect(hexToLab("#ffffff").l).toBeCloseTo(100, 1);
  });
});

describe("kmeans", () => {
  it("is deterministic for a fixed seed", () => {
    const pts: Vec3[] = [];
    for (let i = 0; i < 50; i++) pts.push([10 + (i % 3), 5, -5], [80 - (i % 3), -20, 30]);
    const a = kmeans(pts, 2, { seed: 7 });
    const b = kmeans(pts, 2, { seed: 7 });
    expect(a.centroids).toEqual(b.centroids);
    expect(Array.from(a.assignments)).toEqual(Array.from(b.assignments));
  });

  it("separates two tight clusters", () => {
    const pts: Vec3[] = [];
    for (let i = 0; i < 100; i++) pts.push([10, 0, 0]);
    for (let i = 0; i < 100; i++) pts.push([90, 0, 0]);
    const { centroids } = kmeans(pts, 2, { seed: 1 });
    const ls = centroids.map((c) => c[0]).sort((x, y) => x - y);
    expect(ls[0]).toBeCloseTo(10, 1);
    expect(ls[1]).toBeCloseTo(90, 1);
  });
});

/** Build a width x height RGBA buffer: left half = `left`, right half = `right`. */
function twoColorRGBA(width: number, height: number, left: number[], right: number[]): Buffer {
  const buf = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const c = x < width / 2 ? left : right;
      const p = (y * width + x) * 4;
      buf[p] = c[0]; buf[p + 1] = c[1]; buf[p + 2] = c[2]; buf[p + 3] = 255;
    }
  }
  return buf;
}

async function readPixelLab(png: Buffer, width: number, x: number, y: number) {
  const { data } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  const p = (y * width + x) * 4;
  return rgb255ToLab(data[p], data[p + 1], data[p + 2]);
}

describe("separationRemap (A1 acceptance)", () => {
  const W = 64, H = 64;
  const LEFT = [40, 90, 120];    // target separation (muted blue)
  const RIGHT = [225, 205, 40];  // off-target separation (yellow) — distinct cluster, beyond coverage tolerance

  // Target color shares the source separation's luminance (the op preserves L),
  // so a correct remap lands the separation on the target color in chroma.
  const leftLab = rgb255ToLab(LEFT[0], LEFT[1], LEFT[2]);
  const targetLab = { l: leftLab.l, a: 45, b: 25 };
  const targetRgb = labToRgb255(targetLab);
  const toColor = `rgb(${targetRgb.r}, ${targetRgb.g}, ${targetRgb.b})`;
  const fromColor = `rgb(${LEFT[0]}, ${LEFT[1]}, ${LEFT[2]})`;

  beforeEach(() => {
    mockDecode.mockImplementation(async () => ({
      buffer: twoColorRGBA(W, H, LEFT, RIGHT),
      width: W,
      height: H,
    }));
  });

  it("remaps the target separation to within ΔE2000 <= 5 of the target color", async () => {
    const out = await separationRemap({ url: "x" }, FULL_FABRIC, { fromColor, toColor, coverage: 100 });
    const lab = await readPixelLab(out, W, 16, 32); // left half
    expect(deltaE2000(lab, targetLab)).toBeLessThanOrEqual(5);
  });

  it("preserves luminance in the remapped region (texture intact)", async () => {
    const out = await separationRemap({ url: "x" }, FULL_FABRIC, { fromColor, toColor, coverage: 100 });
    const lab = await readPixelLab(out, W, 16, 32);
    expect(Math.abs(lab.l - leftLab.l)).toBeLessThanOrEqual(1);
  });

  it("leaves off-target separations unchanged (ΔE2000 <= 2)", async () => {
    const out = await separationRemap({ url: "x" }, FULL_FABRIC, { fromColor, toColor, coverage: 100 });
    const lab = await readPixelLab(out, W, 48, 32); // right half
    const rightLab = rgb255ToLab(RIGHT[0], RIGHT[1], RIGHT[2]);
    expect(deltaE2000(lab, rightLab)).toBeLessThanOrEqual(2);
  });

  it("is deterministic (same input -> identical bytes)", async () => {
    const a = await separationRemap({ url: "x" }, FULL_FABRIC, { fromColor, toColor, coverage: 100 });
    const b = await separationRemap({ url: "x" }, FULL_FABRIC, { fromColor, toColor, coverage: 100 });
    expect(Buffer.compare(a, b)).toBe(0);
  });
});
