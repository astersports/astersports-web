/**
 * Spike S3 guard: confirms `sharp` loads and performs a resize + EXIF-bake
 * (.rotate()) round-trip under the test runtime. `sharp` is the hard dependency
 * for all deterministic Print Studio ops (decodeUpright, A1 separation remap,
 * scale, density). If this fails in the deploy runtime, the deterministic track
 * is blocked (Amendment 1 spike S3).
 */
import { describe, it, expect } from "vitest";
import sharp from "sharp";

describe("sharp (spike S3)", () => {
  it("loads and reports a version", () => {
    expect(typeof sharp.versions.sharp).toBe("string");
  });

  it("performs a resize + .rotate() round-trip with correct raw dimensions", async () => {
    const base = await sharp({
      create: { width: 100, height: 60, channels: 3, background: { r: 200, g: 30, b: 40 } },
    })
      .jpeg()
      .toBuffer();

    const out = await sharp(base).rotate().resize(50, 30, { fit: "fill" }).png().toBuffer();
    const { data, info } = await sharp(out).raw().toBuffer({ resolveWithObject: true });

    expect(info.width).toBe(50);
    expect(info.height).toBe(30);
    expect(data.length).toBe(info.width * info.height * info.channels);
  });
});
