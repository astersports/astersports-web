import { describe, it, expect } from "vitest";
import { largestComponentBBox } from "./_core/studio/ops/connectedComponents";

describe("largestComponentBBox", () => {
  it("ignores a disconnected rogue speck, returns the main component bbox", () => {
    const w = 100, h = 100;
    const r = new Uint8Array(w * h);
    for (let y = 25; y <= 74; y++) for (let x = 25; x <= 74; x++) r[y * w + x] = 255; // 50x50 block
    r[99 * w + 99] = 255; // rogue island (single pixel)
    expect(largestComponentBBox(r, w, h)).toEqual({ xmin: 25, xmax: 74, ymin: 25, ymax: 74 });
  });

  it("returns null for an empty mask", () => {
    expect(largestComponentBBox(new Uint8Array(100), 10, 10)).toBeNull();
  });

  it("picks the larger of two components deterministically", () => {
    const w = 50, h = 10;
    const r = new Uint8Array(w * h);
    for (let x = 0; x < 5; x++) r[x] = 255;          // small (5px, row 0)
    for (let x = 20; x < 40; x++) r[w + x] = 255;    // large (20px, row 1)
    expect(largestComponentBBox(r, w, h)).toEqual({ xmin: 20, xmax: 39, ymin: 1, ymax: 1 });
  });

  it("treats diagonal-only neighbors as separate components (4-connectivity)", () => {
    const w = 10, h = 10;
    const r = new Uint8Array(w * h);
    // two 1px blocks touching only diagonally; each area 1 -> first found wins
    r[2 * w + 2] = 255;
    r[3 * w + 3] = 255;
    expect(largestComponentBBox(r, w, h)).toEqual({ xmin: 2, xmax: 2, ymin: 2, ymax: 2 });
  });
});
