/**
 * Density v2 (redistribute) live-helper test. Mirrors densityLive.test.ts, but for
 * the generateDensityRedistributeImage path that STUDIO_DENSITY_REDISTRIBUTE routes
 * the money path to (studioEngine.runVariation selects it over generateDensityImage
 * when ENV.studioDensityRedistribute is on). Verifies it resolves the source URL,
 * makes ONE getSegmentation call (fabric + instances from a single SAM2 call), runs
 * densityRedistribute, encodes to PNG, returns { png, removed }. Also verifies null
 * on degrade (no raster / no instances) and the removed===0 no-op guard — all of
 * which the SSE caller turns into FAIL + REFUND (never prompt-fall). This locks the
 * effect-based no-op-billing guard (CLAUDE.md §1) for the v2 path, which is wired but
 * flag-gated: STUDIO_DENSITY_REDISTRIBUTE stays OFF per standing instruction (only
 * STUDIO_SCALE_LIVE + STUDIO_DENSITY_LIVE are authorized live), so this covers the path
 * that would run if/when Frank flips it — the guard is in place before that ever happens.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./_core/masking", () => ({
  getMaskProvider: vi.fn(),
  validateInstanceCount: vi.fn().mockReturnValue({ valid: true }),
}));
vi.mock("./_core/studio/ops/densityRedistribute", () => ({ densityRedistribute: vi.fn() }));
vi.mock("./storage", () => ({ storageGetSignedUrl: vi.fn() }));
vi.mock("sharp", () => {
  const mockPng = vi.fn().mockReturnThis();
  const mockToBuffer = vi.fn().mockResolvedValue(Buffer.from([137, 80, 78, 71])); // PNG magic bytes
  const sharpFn = vi.fn().mockReturnValue({ png: mockPng, toBuffer: mockToBuffer });
  return { default: sharpFn };
});

import { getMaskProvider } from "./_core/masking";
import { densityRedistribute } from "./_core/studio/ops/densityRedistribute";
import { storageGetSignedUrl } from "./storage";
import { generateDensityRedistributeImage } from "./aiEngine";

const mockProvider = getMaskProvider as unknown as ReturnType<typeof vi.fn>;
const mockRedistribute = densityRedistribute as unknown as ReturnType<typeof vi.fn>;
const mockSign = storageGetSignedUrl as unknown as ReturnType<typeof vi.fn>;

const fabricWithRaster = {
  bbox: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 },
  confidence: 0.95,
  provider: "sam2" as const,
  raster: { width: 100, height: 100, data: new Uint8Array(10000).fill(255) },
};

const fabricNoRaster = {
  bbox: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 },
  confidence: 0.9,
  provider: "classical" as const,
  // no raster field
};

const instances = [
  { bbox: { x: 0.2, y: 0.2, w: 0.1, h: 0.1 }, raster: { width: 10, height: 10, data: new Uint8Array(100).fill(255) } },
  { bbox: { x: 0.5, y: 0.5, w: 0.1, h: 0.1 }, raster: { width: 10, height: 10, data: new Uint8Array(100).fill(255) } },
  { bbox: { x: 0.7, y: 0.3, w: 0.1, h: 0.1 }, raster: { width: 10, height: 10, data: new Uint8Array(100).fill(255) } },
];

/** Provider whose single getSegmentation returns the given fabric + instances. */
function providerWith(fabric: unknown, insts: unknown) {
  return { getSegmentation: vi.fn().mockResolvedValue({ fabric, instances: insts }) };
}

/** densityRedistribute result shape (RedistributeResult): the helper reads only
 *  `.removed` (no-op guard) + `.data/.width/.height` (sharp encode). */
const redistributeResult = (removed: number) => ({
  width: 100,
  height: 100,
  data: new Uint8Array(40000),
  kept: instances.length - removed,
  removed,
  targets: [],
  assignments: [],
});

beforeEach(() => vi.clearAllMocks());

describe("generateDensityRedistributeImage (single-call getSegmentation, v2 live path)", () => {
  it("signs a /manus-storage url, runs ONE getSegmentation + densityRedistribute, returns PNG + removed", async () => {
    mockSign.mockResolvedValue("https://signed/garment.jpg");
    const provider = providerWith(fabricWithRaster, instances);
    mockProvider.mockReturnValue(provider);
    mockRedistribute.mockResolvedValue(redistributeResult(1));

    const result = await generateDensityRedistributeImage("/manus-storage/skirt.jpg", 30);

    expect(result).not.toBeNull();
    expect(result!.png).toBeInstanceOf(Buffer);
    expect(result!.removed).toBe(1);
    expect(mockSign).toHaveBeenCalledWith("skirt.jpg");
    expect(provider.getSegmentation).toHaveBeenCalledTimes(1); // single SAM2 call
    expect(mockRedistribute).toHaveBeenCalledWith({
      image: { url: "https://signed/garment.jpg" },
      fabric: fabricWithRaster,
      instances,
      percent: 30,
    });
  });

  it("passes a non-storage url through unsigned", async () => {
    mockProvider.mockReturnValue(providerWith(fabricWithRaster, instances));
    mockRedistribute.mockResolvedValue(redistributeResult(2));

    const result = await generateDensityRedistributeImage("https://cdn.example.com/dress.jpg", 50);

    expect(result).not.toBeNull();
    expect(result!.removed).toBe(2);
    expect(mockSign).not.toHaveBeenCalled();
  });

  it("returns null when the fabric has no raster (degrade -> fail+refund)", async () => {
    mockProvider.mockReturnValue(providerWith(fabricNoRaster, instances));
    const result = await generateDensityRedistributeImage("https://x/y.jpg", 20);
    expect(result).toBeNull();
    expect(mockRedistribute).not.toHaveBeenCalled();
  });

  it("returns null when there are no instances (degrade -> fail+refund)", async () => {
    mockProvider.mockReturnValue(providerWith(fabricWithRaster, []));
    const result = await generateDensityRedistributeImage("https://x/y.jpg", 20);
    expect(result).toBeNull();
    expect(mockRedistribute).not.toHaveBeenCalled();
  });

  it("returns null when densityRedistribute removed 0 (no-op guard -> fail+refund)", async () => {
    mockProvider.mockReturnValue(providerWith(fabricWithRaster, instances));
    mockRedistribute.mockResolvedValue(redistributeResult(0));
    const result = await generateDensityRedistributeImage("https://x/y.jpg", 5);
    expect(result).toBeNull();
  });

  it("propagates hard errors from densityRedistribute", async () => {
    mockProvider.mockReturnValue(providerWith(fabricWithRaster, instances));
    mockRedistribute.mockRejectedValue(new Error("Image decode failed"));
    await expect(generateDensityRedistributeImage("https://x/y.jpg", 20)).rejects.toThrow("Image decode failed");
  });
});
