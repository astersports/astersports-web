/**
 * D-C deterministic density helper test. Verifies generateDensityImage resolves
 * the source URL, calls the SAM2 provider for fabric raster + instances, runs
 * densityThin, encodes to PNG, and returns { png, removed }. Also verifies the
 * null-return degradation paths (no raster, no instances).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./_core/masking", () => ({ getMaskProvider: vi.fn() }));
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

beforeEach(() => {
  vi.clearAllMocks();
});

describe("generateDensityImage", () => {
  it("signs a /manus-storage url, runs SAM2 + densityThin, returns PNG + removed count", async () => {
    mockSign.mockResolvedValue("https://signed/garment.jpg");
    mockProvider.mockReturnValue({
      getFabricMask: vi.fn().mockResolvedValue(fabricWithRaster),
      getInstanceMasks: vi.fn().mockResolvedValue(instances),
    });
    mockDensityThin.mockResolvedValue({
      width: 100,
      height: 100,
      data: new Uint8Array(40000), // RGBA
      removed: 1,
    });

    const result = await generateDensityImage("/manus-storage/skirt.jpg", 30);

    expect(result).not.toBeNull();
    expect(result!.png).toBeInstanceOf(Buffer);
    expect(result!.removed).toBe(1);
    expect(mockSign).toHaveBeenCalledWith("skirt.jpg");
    expect(mockDensityThin).toHaveBeenCalledWith({
      image: { url: "https://signed/garment.jpg" },
      fabric: fabricWithRaster,
      instances,
      percent: 30,
    });
  });

  it("passes a non-storage url through unsigned", async () => {
    mockProvider.mockReturnValue({
      getFabricMask: vi.fn().mockResolvedValue(fabricWithRaster),
      getInstanceMasks: vi.fn().mockResolvedValue(instances),
    });
    mockDensityThin.mockResolvedValue({
      width: 100,
      height: 100,
      data: new Uint8Array(40000),
      removed: 2,
    });

    const result = await generateDensityImage("https://cdn.example.com/dress.jpg", 50);

    expect(result).not.toBeNull();
    expect(result!.removed).toBe(2);
    expect(mockSign).not.toHaveBeenCalled();
    expect(mockDensityThin).toHaveBeenCalledWith(
      expect.objectContaining({ image: { url: "https://cdn.example.com/dress.jpg" } })
    );
  });

  it("returns null when provider has no raster (D-B degradation)", async () => {
    mockSign.mockResolvedValue("https://signed/garment.jpg");
    mockProvider.mockReturnValue({
      getFabricMask: vi.fn().mockResolvedValue(fabricNoRaster),
      getInstanceMasks: vi.fn(),
    });

    const result = await generateDensityImage("/manus-storage/skirt.jpg", 20);

    expect(result).toBeNull();
    expect(mockDensityThin).not.toHaveBeenCalled();
  });

  it("returns null when provider returns empty instances (D-B degradation)", async () => {
    mockSign.mockResolvedValue("https://signed/garment.jpg");
    mockProvider.mockReturnValue({
      getFabricMask: vi.fn().mockResolvedValue(fabricWithRaster),
      getInstanceMasks: vi.fn().mockResolvedValue([]), // empty = degraded
    });

    const result = await generateDensityImage("/manus-storage/skirt.jpg", 20);

    expect(result).toBeNull();
    expect(mockDensityThin).not.toHaveBeenCalled();
  });

  it("propagates hard errors from densityThin", async () => {
    mockSign.mockResolvedValue("https://signed/garment.jpg");
    mockProvider.mockReturnValue({
      getFabricMask: vi.fn().mockResolvedValue(fabricWithRaster),
      getInstanceMasks: vi.fn().mockResolvedValue(instances),
    });
    mockDensityThin.mockRejectedValue(new Error("Image decode failed"));

    await expect(generateDensityImage("/manus-storage/skirt.jpg", 20)).rejects.toThrow(
      "Image decode failed"
    );
  });
});
