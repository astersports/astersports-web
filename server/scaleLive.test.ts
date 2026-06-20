/**
 * Scale-live helper test. Verifies generateScaledImage resolves the source URL,
 * runs the SAM2 fabric mask + scalePrintRepeat, encodes the op's RGBA to PNG, and
 * throws the D-C no-op sentinel on an empty fabric raster. Provider/op/storage mocked.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./_core/masking", () => ({ getMaskProvider: vi.fn() }));
vi.mock("./_core/studio/ops/scaleRepeat", () => ({ scalePrintRepeat: vi.fn() }));
vi.mock("./storage", () => ({ storageGetSignedUrl: vi.fn() }));

import sharp from "sharp";
import { getMaskProvider } from "./_core/masking";
import { scalePrintRepeat } from "./_core/studio/ops/scaleRepeat";
import { storageGetSignedUrl } from "./storage";
import { generateScaledImage, NO_OP_SCALE_ERROR } from "./aiEngine";

const mockProvider = getMaskProvider as unknown as ReturnType<typeof vi.fn>;
const mockScale = scalePrintRepeat as unknown as ReturnType<typeof vi.fn>;
const mockSign = storageGetSignedUrl as unknown as ReturnType<typeof vi.fn>;

/** A fabric mask whose raster has `on` included pixels (or none). */
function fabric(on: boolean) {
  const data = new Uint8Array(4); // 2x2
  if (on) data.fill(255);
  return { bbox: { x: 0, y: 0, w: 1, h: 1 }, confidence: 1, provider: "sam2", raster: { width: 2, height: 2, data } };
}

beforeEach(() => vi.clearAllMocks());

describe("generateScaledImage", () => {
  it("signs a /manus-storage url, runs scalePrintRepeat, returns a PNG of the op RGBA", async () => {
    mockProvider.mockReturnValue({ getFabricMask: vi.fn().mockResolvedValue(fabric(true)) });
    mockSign.mockResolvedValue("https://signed/x.jpg");
    const rgba = Buffer.alloc(2 * 2 * 4, 120);
    mockScale.mockResolvedValue({ data: rgba, width: 2, height: 2 });

    const out = await generateScaledImage("/manus-storage/k.jpg", { targetFraction: 0.5 });

    expect(mockSign).toHaveBeenCalledWith("k.jpg");
    expect(mockScale).toHaveBeenCalledWith({ image: { url: "https://signed/x.jpg" }, fabric: fabric(true), targetFraction: 0.5 });
    // returns a real PNG of the op output
    const meta = await sharp(out).metadata();
    expect(meta.format).toBe("png");
    expect(meta.width).toBe(2);
  });

  it("throws the D-C no-op sentinel on an empty fabric raster (refund path)", async () => {
    mockProvider.mockReturnValue({ getFabricMask: vi.fn().mockResolvedValue(fabric(false)) });
    await expect(generateScaledImage("https://x/y.png", { targetFraction: 0.5 }))
      .rejects.toThrow(NO_OP_SCALE_ERROR);
    expect(mockScale).not.toHaveBeenCalled();
  });
});
