/**
 * D-C deterministic density helper test. Verifies generateDensityImage resolves
 * the source URL, calls the provider's SINGLE getSegmentation (fabric + instances
 * from one SAM2 call), runs densityThin, encodes to PNG, returns { png, removed }.
 * Also verifies null on degrade (no raster / no instances) and the removed===0
 * no-op guard — all of which the caller turns into FAIL + REFUND (never prompt-fall).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./_core/masking", () => ({
  getMaskProvider: vi.fn(),
  validateInstanceCount: vi.fn().mockReturnValue({ valid: true }),
}));
vi.mock("./_core/studio/ops/densityThin", () => ({ densityThin: vi.fn() }));
vi.mock("./storage", () => ({ storageGetSignedUrl: vi.fn() }));
vi.mock("sharp", () => {
  const mockPng = vi.fn().mockReturnThis();
  const mockToBuffer = vi.fn().mockResolvedValue(Buffer.from([137, 80, 78, 71])); // PNG magic bytes
  const sharpFn = vi.fn().mockReturnValue({ png: mockPng, toBuffer: mockToBuffer });
  return { default: sharpFn };
});

import { getMaskProvider } from "./_core/masking";
import { densityThin } from "./_core/studio/ops/densityThin";
import { storageGetSignedUrl } from "./storage";
import { generateDensityImage } from "./aiEngine";

const mockProvider = getMaskProvider as unknown as ReturnType<typeof vi.fn>;
const mockDensityThin = densityThin as unknown as ReturnType<typeof vi.fn>;
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

beforeEach(() => vi.clearAllMocks());

describe("generateDensityImage (single-call getSegmentation)", () => {
  it("signs a /manus-storage url, runs ONE getSegmentation + densityThin, returns PNG + removed", async () => {
    mockSign.mockResolvedValue("https://signed/garment.jpg");
    const provider = providerWith(fabricWithRaster, instances);
    mockProvider.mockReturnValue(provider);
    mockDensityThin.mockResolvedValue({ width: 100, height: 100, data: new Uint8Array(40000), removed: 1 });

    const result = await generateDensityImage("/manus-storage/skirt.jpg", 30);

    expect(result).not.toBeNull();
    expect(result!.png).toBeInstanceOf(Buffer);
    expect(result!.removed).toBe(1);
    expect(mockSign).toHaveBeenCalledWith("skirt.jpg");
    expect(provider.getSegmentation).toHaveBeenCalledTimes(1); // single SAM2 call
    expect(provider.getSegmentation).toHaveBeenCalledWith({ url: "https://signed/garment.jpg" });
    expect(mockDensityThin).toHaveBeenCalledWith({
      image: { url: "https://signed/garment.jpg" },
      fabric: fabricWithRaster,
      instances,
      percent: 30,
      useLama: false,
      infillProvider: "lama",
    });
  });

  it("passes a non-storage url through unsigned", async () => {
    mockProvider.mockReturnValue(providerWith(fabricWithRaster, instances));
    mockDensityThin.mockResolvedValue({ width: 100, height: 100, data: new Uint8Array(40000), removed: 2 });

    const result = await generateDensityImage("https://cdn.example.com/dress.jpg", 50);

    expect(result).not.toBeNull();
    expect(result!.removed).toBe(2);
    expect(mockSign).not.toHaveBeenCalled();
  });

  it("returns null when the fabric has no raster (degrade -> fail+refund)", async () => {
    mockProvider.mockReturnValue(providerWith(fabricNoRaster, instances));
    const result = await generateDensityImage("https://x/y.jpg", 20);
    expect(result).toBeNull();
    expect(mockDensityThin).not.toHaveBeenCalled();
  });

  it("returns null when there are no instances (degrade -> fail+refund)", async () => {
    mockProvider.mockReturnValue(providerWith(fabricWithRaster, []));
    const result = await generateDensityImage("https://x/y.jpg", 20);
    expect(result).toBeNull();
    expect(mockDensityThin).not.toHaveBeenCalled();
  });

  it("returns null when densityThin removed 0 (no-op guard -> fail+refund)", async () => {
    mockProvider.mockReturnValue(providerWith(fabricWithRaster, instances));
    mockDensityThin.mockResolvedValue({ width: 100, height: 100, data: new Uint8Array(40000), removed: 0 });
    const result = await generateDensityImage("https://x/y.jpg", 5);
    expect(result).toBeNull();
  });

  it("propagates hard errors from densityThin", async () => {
    mockProvider.mockReturnValue(providerWith(fabricWithRaster, instances));
    mockDensityThin.mockRejectedValue(new Error("Image decode failed"));
    await expect(generateDensityImage("https://x/y.jpg", 20)).rejects.toThrow("Image decode failed");
  });
});
