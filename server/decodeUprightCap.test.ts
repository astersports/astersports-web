/**
 * T1.6 — decodeUpright working-resolution cap.
 *
 * The deterministic ops hold the image RGBA + up to STUDIO_MAX_INSTANCES full-frame motif
 * masks at once, so at full print resolution a large image OOM-kills the worker mid-op. The
 * cap (default 2 MP) downscales at the single decode boundary so every downstream raster —
 * image and SAM2-derived masks alike — shares the bounded dimensions. Small images (the eval
 * fixtures) must pass through untouched so existing behavior/tests are unaffected.
 */
import { describe, it, expect, beforeEach } from "vitest";
import sharp from "sharp";
import { writeFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decodeUpright, clearDecodeCache } from "./_core/image/decodeUpright";

async function writeImage(w: number, h: number): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "decode-cap-"));
  const path = join(dir, `img-${w}x${h}.png`);
  const png = await sharp({
    create: { width: w, height: h, channels: 3, background: { r: 100, g: 120, b: 140 } },
  })
    .png()
    .toBuffer();
  await writeFile(path, png);
  return `file://${path}`;
}

describe("decodeUpright — T1.6 working-resolution cap (default 2 MP)", () => {
  beforeEach(() => clearDecodeCache());

  it("downscales an oversized image under the cap, preserving aspect ratio", async () => {
    const { width, height } = await decodeUpright(await writeImage(4000, 3000)); // 12 MP, 4:3
    // 2 MP cap → longer side bounded at floor(sqrt(2e6)) = 1414.
    expect(Math.max(width, height)).toBeLessThanOrEqual(1414);
    expect(width * height).toBeLessThanOrEqual(2_000_000);
    expect(width / height).toBeCloseTo(4 / 3, 1); // aspect preserved
  });

  it("leaves a small image untouched (no enlargement, exact dims)", async () => {
    const { width, height } = await decodeUpright(await writeImage(800, 600));
    expect(width).toBe(800);
    expect(height).toBe(600);
  });
});
