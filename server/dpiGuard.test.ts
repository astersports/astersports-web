import { describe, it, expect, vi } from "vitest";
import sharp from "sharp";
import {
  checkUpscaleDpi,
  checkScaleDownAdvisory,
  MIN_EFFECTIVE_DPI,
  MIN_FEATURE_INCHES,
} from "./_core/studio/guards/dpiGuard";

describe("DPI Guard", () => {
  describe("checkUpscaleDpi", () => {
    it("returns no-op for downscale (f <= 1)", async () => {
      const result = await checkUpscaleDpi(Buffer.alloc(0), 0.7);
      expect(result.reject).toBe(false);
      expect(result.warn).toBe(false);
      expect(result.message).toBeNull();
    });

    it("rejects upscale when effective DPI < 150 (source has DPI metadata)", async () => {
      // Create a 100x100 PNG with DPI=200
      const img = await sharp({
        create: { width: 100, height: 100, channels: 3, background: { r: 255, g: 0, b: 0 } },
      })
        .withMetadata({ density: 200 })
        .png()
        .toBuffer();

      // Scale factor 2.0 -> effective DPI = 200/2 = 100 < 150
      const result = await checkUpscaleDpi(img, 2.0);
      expect(result.reject).toBe(true);
      expect(result.warn).toBe(false);
      expect(result.sourceDpi).toBe(200);
      expect(result.effectiveDpi).toBe(100);
      expect(result.message).toContain("150");
    });

    it("allows upscale when effective DPI >= 150", async () => {
      // Create a 100x100 PNG with DPI=300
      const img = await sharp({
        create: { width: 100, height: 100, channels: 3, background: { r: 0, g: 255, b: 0 } },
      })
        .withMetadata({ density: 300 })
        .png()
        .toBuffer();

      // Scale factor 1.5 -> effective DPI = 300/1.5 = 200 >= 150
      const result = await checkUpscaleDpi(img, 1.5);
      expect(result.reject).toBe(false);
      expect(result.warn).toBe(false);
      expect(result.message).toBeNull();
      expect(result.sourceDpi).toBe(300);
      expect(result.effectiveDpi).toBe(200);
    });

    it("warns (not rejects) when source has no DPI metadata", async () => {
      // Create a PNG without DPI metadata
      const img = await sharp({
        create: { width: 100, height: 100, channels: 3, background: { r: 0, g: 0, b: 255 } },
      })
        .png()
        .toBuffer();

      const result = await checkUpscaleDpi(img, 1.5);
      expect(result.reject).toBe(false);
      expect(result.warn).toBe(true);
      expect(result.message).toContain("no DPI metadata");
      expect(result.sourceDpi).toBeNull();
    });

    it("warns when metadata read fails (corrupt buffer)", async () => {
      const result = await checkUpscaleDpi(Buffer.from("not an image"), 1.5);
      expect(result.reject).toBe(false);
      expect(result.warn).toBe(true);
      expect(result.sourceDpi).toBeNull();
    });

    it("uses resolveUrl when provided", async () => {
      const img = await sharp({
        create: { width: 50, height: 50, channels: 3, background: { r: 128, g: 128, b: 128 } },
      })
        .withMetadata({ density: 300 })
        .png()
        .toBuffer();

      // Mock resolver that returns the buffer path
      const tmpPath = "/tmp/dpi-test-image.png";
      const fs = await import("fs");
      fs.writeFileSync(tmpPath, img);

      const resolver = async (url: string) => tmpPath;
      const result = await checkUpscaleDpi("/manus-storage/test.png", 1.2, resolver);
      expect(result.reject).toBe(false);
      expect(result.sourceDpi).toBe(300);
      expect(result.effectiveDpi).toBe(250);

      fs.unlinkSync(tmpPath);
    });
  });

  describe("checkScaleDownAdvisory", () => {
    it("returns null for upscale", () => {
      const result = checkScaleDownAdvisory(300, 1.5, 10);
      expect(result).toBeNull();
    });

    it("returns null when no DPI info", () => {
      const result = checkScaleDownAdvisory(null, 0.5, 10);
      expect(result).toBeNull();
    });

    it("returns null when features stay above floor", () => {
      // 10px feature at 300dpi scaled to 50% = 5px = 5/300 = 0.0167 inches
      // That's below MIN_FEATURE_INCHES (0.02), so this SHOULD warn
      // Let's use a larger feature: 20px at 300dpi scaled to 50% = 10px = 10/300 = 0.033 > 0.02
      const result = checkScaleDownAdvisory(300, 0.5, 20);
      expect(result).toBeNull();
    });

    it("returns advisory when features would be too small", () => {
      // 5px feature at 300dpi scaled to 30% = 1.5px = 1.5/300 = 0.005 inches < 0.02
      const result = checkScaleDownAdvisory(300, 0.3, 5);
      expect(result).not.toBeNull();
      expect(result).toContain("advisory");
      expect(result).toContain("mm");
    });
  });
});
