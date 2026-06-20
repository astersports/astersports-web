/**
 * Round-trip: SAM2-style per-instance masks -> buildInstanceLabelMap (label-map
 * PNG) -> loadInstanceLabelMap recovers the same instance count and per-instance
 * pixels. This is the bridge that makes the density eval runner turnkey from a
 * SAM2 autoSegment result.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { buildInstanceLabelMap, instanceColor } from "./_core/studio/eval/buildLabelMap";
import { loadInstanceLabelMap } from "./_core/studio/eval/evalMaskIO";

const W = 40, H = 40;

/** A binary mask PNG (white square at [x0,y0,x1,y1)). */
async function maskPng(x0: number, y0: number, x1: number, y1: number): Promise<Buffer> {
  const buf = Buffer.alloc(W * H);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) buf[y * W + x] = 255;
  return sharp(buf, { raw: { width: W, height: H, channels: 1 } }).png().toBuffer();
}

describe("buildInstanceLabelMap round-trip", () => {
  it("encodes bright, non-ground colours", () => {
    for (const i of [0, 1, 255, 256, 79]) {
      const [r, g, b] = instanceColor(i);
      expect(Math.max(r, g, b)).toBeGreaterThan(30); // never mistaken for ground
    }
    // bijective: distinct indices -> distinct colours
    expect(instanceColor(0)).not.toEqual(instanceColor(256));
  });

  it("three masks -> label map -> three recovered instances at the right spots", async () => {
    const masks = [
      await maskPng(2, 2, 10, 10),
      await maskPng(20, 4, 30, 14),
      await maskPng(6, 24, 18, 36),
    ];
    const labelPng = await buildInstanceLabelMap(masks, W, H);

    const dir = await mkdtemp(path.join(tmpdir(), "labelmap-"));
    try {
      const file = path.join(dir, "label.png");
      await writeFile(file, labelPng);
      const { labels, instances } = await loadInstanceLabelMap(file, W, H);

      expect(instances.length).toBe(3);
      // every instance has some labelled pixels; ground stays -1 at a corner
      expect(labels[0]).toBe(-1);
      const counts = new Map<number, number>();
      for (let i = 0; i < labels.length; i++) {
        if (labels[i] >= 0) counts.set(labels[i], (counts.get(labels[i]) ?? 0) + 1);
      }
      expect(counts.size).toBe(3);
      // the first mask is an 8x8 = 64px square
      const minCount = Math.min(...Array.from(counts.values()));
      expect(minCount).toBeGreaterThanOrEqual(60);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
