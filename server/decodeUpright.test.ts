/**
 * decodeUpright local-file support (enables offline eval on local sample images).
 */
import { describe, it, expect, afterAll } from "vitest";
import { tmpdir } from "node:os";
import path from "node:path";
import { writeFile, rm } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import sharp from "sharp";
import { decodeUpright, clearDecodeCache } from "./_core/image/decodeUpright";

const tmpPng = path.join(tmpdir(), `decodeUpright-${Date.now()}.png`);

afterAll(async () => {
  await rm(tmpPng, { force: true });
});

describe("decodeUpright (local files)", () => {
  it("decodes a local filesystem path to upright RGBA", async () => {
    const png = await sharp({
      create: { width: 20, height: 12, channels: 4, background: { r: 10, g: 20, b: 30, alpha: 1 } },
    }).png().toBuffer();
    await writeFile(tmpPng, png);

    clearDecodeCache();
    const img = await decodeUpright(tmpPng);
    expect(img.width).toBe(20);
    expect(img.height).toBe(12);
    expect(img.buffer.length).toBe(20 * 12 * 4);
  });

  it("decodes a file:// URL", async () => {
    clearDecodeCache();
    const img = await decodeUpright(pathToFileURL(tmpPng).href);
    expect(img.width).toBe(20);
    expect(img.height).toBe(12);
  });

  it("returns a mutable copy (mutation does not corrupt the cache)", async () => {
    clearDecodeCache();
    const a = await decodeUpright(tmpPng);
    a.buffer[0] = 255;
    const b = await decodeUpright(tmpPng);
    expect(b.buffer[0]).not.toBe(255);
  });
});
