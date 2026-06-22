/**
 * SAM2 mask-assembly + provider tests. The pure mask->RasterMask/InstanceMask
 * logic is verified for real; the Replicate client is mocked (the live call needs
 * separate verification against Manus's working client).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import sharp from "sharp";

vi.mock("./_core/llm", () => ({ invokeLLM: vi.fn() }));
vi.mock("./_core/image/decodeUpright", () => ({ decodeUpright: vi.fn() }));
import { invokeLLM } from "./_core/llm";
import { decodeUpright } from "./_core/image/decodeUpright";
import { decodeMaskToRaster, rasterBBox, instancesFromMasks } from "./_core/masking/sam2Mask";
import { createSam2Provider } from "./_core/masking/sam2Provider";
import type { Sam2Client } from "./_core/masking/replicateSam2";
import { resolveModelRef } from "./_core/masking/replicateSam2";

const mockLLM = invokeLLM as unknown as ReturnType<typeof vi.fn>;
const mockDecode = decodeUpright as unknown as ReturnType<typeof vi.fn>;

/** A 1-channel mask PNG with a filled rectangle. */
async function maskPng(W: number, H: number, x0: number, y0: number, x1: number, y1: number): Promise<Buffer> {
  const buf = Buffer.alloc(W * H);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) buf[y * W + x] = 255;
  return sharp(buf, { raw: { width: W, height: H, channels: 1 } }).png().toBuffer();
}

describe("resolveModelRef (REPLICATE_SAM2_MODEL -> run() ref)", () => {
  it("pins a bare version hash to meta/sam-2:<hash>", () => {
    expect(resolveModelRef("fe97b453a6455861e3bac769b441ca1f1086110da7466dbb65cf1eecfd60dc83"))
      .toBe("meta/sam-2:fe97b453a6455861e3bac769b441ca1f1086110da7466dbb65cf1eecfd60dc83");
  });
  it("passes a slug or owner/model:version through unchanged", () => {
    expect(resolveModelRef("meta/sam-2")).toBe("meta/sam-2");
    expect(resolveModelRef("meta/sam-2:abc123")).toBe("meta/sam-2:abc123");
  });
  it("defaults to the meta/sam-2 slug when unset", () => {
    expect(resolveModelRef("")).toBe("meta/sam-2");
    expect(resolveModelRef(undefined)).toBe("meta/sam-2");
  });
});

describe("sam2Mask utilities", () => {
  it("decodes a mask PNG to a binary RasterMask at target dims", async () => {
    const r = await decodeMaskToRaster(await maskPng(32, 32, 8, 8, 24, 24), 32, 32);
    expect(r.width).toBe(32);
    expect(r.data[12 * 32 + 12]).toBe(255); // inside
    expect(r.data[0]).toBe(0); // outside
  });

  it("computes a normalized bbox + area", () => {
    const data = new Uint8Array(32 * 32);
    for (let y = 8; y < 24; y++) for (let x = 8; x < 24; x++) data[y * 32 + x] = 255;
    const bb = rasterBBox({ width: 32, height: 32, data })!;
    expect(bb.area).toBe(16 * 16);
    expect(bb.bbox.x).toBeCloseTo(8 / 32, 5);
    expect(bb.bbox.w).toBeCloseTo(16 / 32, 5);
  });

  it("assembles instances and drops specks below minAreaPx", async () => {
    const big = await maskPng(48, 48, 4, 4, 40, 40); // area 36*36 = 1296
    const tiny = await maskPng(48, 48, 1, 1, 4, 4); // area 9
    const insts = await instancesFromMasks([tiny, big], 48, 48, 200);
    expect(insts.length).toBe(1); // tiny dropped
    expect(insts[0].raster).toBeDefined();
  });
});

describe("createSam2Provider (mocked client)", () => {
  const W = 48, H = 48;
  beforeEach(() => {
    mockDecode.mockImplementation(async () => ({ buffer: Buffer.alloc(W * H * 4, 200), width: W, height: H }));
  });

  const client: Sam2Client = {
    autoSegment: async () => ({
      combined: await maskPng(W, H, 8, 8, 40, 40),
      individuals: [await maskPng(W, H, 4, 4, 20, 20), await maskPng(W, H, 28, 28, 44, 44)],
    }),
    boxMask: async () => maskPng(W, H, 8, 8, 40, 40),
  };

  it("reports rasterReady", () => {
    expect(createSam2Provider(client).rasterReady).toBe(true);
  });

  it("getSegmentation returns fabric + instances from ONE autoSegment call", async () => {
    mockLLM.mockResolvedValue({ choices: [{ message: { content: JSON.stringify({ x: 0, y: 0, w: 1, h: 1, confidence: 0.9 }) } }] });
    const spy = vi.fn(client.autoSegment);
    const seg = await createSam2Provider({ ...client, autoSegment: spy }).getSegmentation({ url: "http://x/g.png" });
    expect(spy).toHaveBeenCalledTimes(1); // single SAM2 call for both halves
    expect(seg.fabric.raster).toBeDefined();
    expect(seg.instances.length).toBe(2);
  });

  it("caps instances at STUDIO_MAX_INSTANCES (default 200) to bound memory", async () => {
    mockLLM.mockResolvedValue({ choices: [{ message: { content: JSON.stringify({ x: 0, y: 0, w: 1, h: 1, confidence: 0.9 }) } }] });
    const one = await maskPng(W, H, 4, 4, 20, 20); // 16x16 motif, survives the filters
    const many = Array.from({ length: 205 }, () => one); // pathological over-segmentation
    const capClient: Sam2Client = {
      ...client,
      autoSegment: async () => ({ combined: await maskPng(W, H, 8, 8, 40, 40), individuals: many }),
    };
    const seg = await createSam2Provider(capClient).getSegmentation({ url: "http://x/g.png" });
    expect(seg.instances.length).toBe(200); // capped from 205
  });

  it("getFabricMask returns a raster mask tagged sam2", async () => {
    mockLLM.mockResolvedValue({ choices: [{ message: { content: JSON.stringify({ x: 0.1, y: 0.1, w: 0.8, h: 0.8, confidence: 0.9 }) } }] });
    const fm = await createSam2Provider(client).getFabricMask({ url: "http://x/g.png" });
    expect(fm.provider).toBe("sam2");
    expect(fm.raster).toBeDefined();
    expect(fm.raster!.width).toBe(W);
  });

  it("getInstanceMasks returns area-filtered instances with rasters", async () => {
    const insts = await createSam2Provider(client).getInstanceMasks(
      { url: "http://x/g.png" },
      { bbox: { x: 0, y: 0, w: 1, h: 1 }, confidence: 1, provider: "sam2" }
    );
    expect(insts.length).toBe(2);
    expect(insts.every((i) => i.raster && i.raster.width === W)).toBe(true);
  });
});
