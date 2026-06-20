/**
 * Scale/Density eval-runner wiring tests. Real garment images live on Frank's
 * machine (offline manifests), so these prove the runner orchestration —
 * load masks -> run op -> score with the metric module -> verdict + determinism —
 * end-to-end on synthetic PNGs written to a temp dir and read back via decodeUpright.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { runScaleCase } from "./_core/studio/eval/scaleEval";
import { runDensityCase } from "./_core/studio/eval/densityEval";
import { clearDecodeCache } from "./_core/image/decodeUpright";

const W = 64, H = 64;

/** Write a raw RGBA buffer as a PNG to `dir/name`, return its absolute path. */
async function writePng(dir: string, name: string, rgba: Buffer): Promise<string> {
  const png = await sharp(rgba, { raw: { width: W, height: H, channels: 4 } }).png().toBuffer();
  const file = path.join(dir, name);
  await writeFile(file, png);
  return file;
}

function blank(r: number, g: number, b: number): Buffer {
  const buf = Buffer.alloc(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    buf[i * 4] = r; buf[i * 4 + 1] = g; buf[i * 4 + 2] = b; buf[i * 4 + 3] = 255;
  }
  return buf;
}

/** Paint an 8x8 motif grid; `color(ix,iy)` gives each cell's RGB. */
function paintGrid(buf: Buffer, color: (ix: number, iy: number) => [number, number, number]) {
  for (let iy = 0; iy < 4; iy++) {
    for (let ix = 0; ix < 4; ix++) {
      const [r, g, b] = color(ix, iy);
      const x0 = 4 + ix * 15, y0 = 4 + iy * 15; // 4 motifs across, spaced
      for (let y = y0; y < y0 + 8; y++) {
        for (let x = x0; x < x0 + 8; x++) {
          const p = (y * W + x) * 4;
          buf[p] = r; buf[p + 1] = g; buf[p + 2] = b; buf[p + 3] = 255;
        }
      }
    }
  }
}

describe("eval runners (synthetic, offline)", () => {
  let dir: string;
  let imageUrl: string, maskUrl: string, labelUrl: string;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "evalrunners-"));
    clearDecodeCache();

    // Source: bright-red motifs on near-black ground (motif != ground by ΔE).
    const src = blank(10, 10, 10);
    paintGrid(src, () => [220, 40, 40]);
    imageUrl = await writePng(dir, "src.png", src);

    // Fabric mask: full white (whole image is fabric).
    maskUrl = await writePng(dir, "mask.png", blank(255, 255, 255));

    // Instance label map: each of the 16 motifs a unique colour; ground black.
    const label = blank(0, 0, 0);
    paintGrid(label, (ix, iy) => {
      const id = iy * 4 + ix + 1; // 1..16, never (0,0,0)
      return [40 + id * 12, 200 - id * 8, 60 + id * 9];
    });
    labelUrl = await writePng(dir, "label.png", label);
  });

  afterAll(async () => { await rm(dir, { recursive: true, force: true }); });

  it("scale runner: loads mask, runs op + metric, deterministic, palette preserved", async () => {
    const row = await runScaleCase({ id: "syn-shrink", imageUrl, percent: -50, maskUrl });
    expect(row.error).toBeUndefined();
    expect(row.metrics).toBeDefined();
    expect(Number.isFinite(row.metrics!.measuredFraction)).toBe(true);
    expect(row.deterministic).toBe(true);
    // Same inks, just resized — palette must be preserved.
    expect(row.verdict!.palettePass).toBe(true);
  });

  it("density runner: removes ~percent of instances, counts pass, deterministic", async () => {
    const row = await runDensityCase({ id: "syn-thin30", imageUrl, percent: 30, maskUrl, labelUrl });
    expect(row.error).toBeUndefined();
    expect(row.instances).toBe(16);
    expect(row.removed).toBe(Math.round(16 * 0.3)); // 5
    expect(row.metrics).toBeDefined();
    expect(row.verdict!.countPass).toBe(true);
    expect(row.deterministic).toBe(true);
  });
});
