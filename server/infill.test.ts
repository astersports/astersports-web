/**
 * Base-cloth infill primitive tests.
 * Synthetic fixture: flat base cloth with a vertical L gradient (fold shadow) +
 * a printed blob of different chroma. region = the blob. decodeUpright is mocked
 * so no network/storage is touched.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./_core/image/decodeUpright", () => ({ decodeUpright: vi.fn() }));
import { decodeUpright } from "./_core/image/decodeUpright";
import { infillBaseCloth } from "./_core/studio/ops/infill";
import { rgb255ToLab, labToRgb255, deltaE2000 } from "./_core/studio/ops/color";
import { ssim } from "./_core/studio/eval/metrics";
import type { RasterMask } from "./_core/masking/types";

const mockDecode = decodeUpright as unknown as ReturnType<typeof vi.fn>;

const W = 64, H = 64, CX = 32, CY = 32, R = 14;
const BASE = { L: 60, a: 5, b: 10 }; // base cloth chroma

const rowL = (y: number) => 40 + (y / H) * 40; // vertical fold-shadow gradient 40..80
const inBlob = (x: number, y: number) => (x - CX) ** 2 + (y - CY) ** 2 <= R * R;

/** Fresh synthetic RGBA each call (op mutates in place; mock must not share). */
function buildSynthetic(): Buffer {
  const b = Buffer.alloc(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const c = inBlob(x, y)
        ? labToRgb255({ l: rowL(y), a: 40, b: 25 }) // print: different chroma, same L gradient
        : labToRgb255({ l: rowL(y), a: BASE.a, b: BASE.b }); // base cloth
      const p = (y * W + x) * 4;
      b[p] = c.r; b[p + 1] = c.g; b[p + 2] = c.b; b[p + 3] = 255;
    }
  }
  return b;
}

const region: RasterMask = { width: W, height: H, data: new Uint8Array(W * H) };
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) region.data[y * W + x] = inBlob(x, y) ? 255 : 0;

const run = () =>
  infillBaseCloth({ image: { url: "x" }, region, baseClothLab: BASE });

describe("infillBaseCloth", () => {
  beforeEach(() => {
    mockDecode.mockImplementation(async () => ({ buffer: buildSynthetic(), width: W, height: H }));
  });

  it("fills the region with base-cloth chroma (mean ΔE2000 at own L < 2)", async () => {
    const { data } = await run();
    let sum = 0, cnt = 0;
    for (let i = 0; i < W * H; i++) {
      if (region.data[i] !== 255) continue;
      const p = i * 4;
      const lab = rgb255ToLab(data[p], data[p + 1], data[p + 2]);
      sum += deltaE2000({ l: lab.l, a: lab.a, b: lab.b }, { l: lab.l, a: BASE.a, b: BASE.b });
      cnt++;
    }
    expect(sum / cnt).toBeLessThan(2);
  });

  it("preserves the original L gradient in the filled region (lumSSIM >= 0.99)", async () => {
    const input = buildSynthetic();
    const { data } = await run();
    const lin: number[] = [], lout: number[] = [];
    for (let i = 0; i < W * H; i++) {
      if (region.data[i] !== 255) continue;
      const p = i * 4;
      lin.push(rgb255ToLab(input[p], input[p + 1], input[p + 2]).l);
      lout.push(rgb255ToLab(data[p], data[p + 1], data[p + 2]).l);
    }
    expect(ssim(lin, lout)).toBeGreaterThanOrEqual(0.99);
  });

  it("leaves pixels outside the region+feather byte-identical", async () => {
    const input = buildSynthetic();
    const { data } = await run();
    const border = 8; // well outside the centered blob + 1px feather
    let mismatches = 0;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (!(x < border || x >= W - border || y < border || y >= H - border)) continue;
        const p = (y * W + x) * 4;
        if (data[p] !== input[p] || data[p + 1] !== input[p + 1] || data[p + 2] !== input[p + 2]) mismatches++;
      }
    }
    expect(mismatches).toBe(0);
  });

  it("is deterministic (same inputs -> identical bytes)", async () => {
    const a = (await run()).data;
    const b = (await run()).data;
    expect(Buffer.compare(a, b)).toBe(0);
  });

  it("throws a clear error on a dims mismatch", async () => {
    await expect(
      infillBaseCloth({
        image: { url: "x" },
        region: { width: 10, height: 10, data: new Uint8Array(100) },
        baseClothLab: BASE,
      })
    ).rejects.toThrow(/dims/);
  });
});
