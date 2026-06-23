/**
 * T3.1 — Segmentation cache acceptance test.
 * Verifies: second identical request returns cached masks (no model call); output byte-identical.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { cachedSegmentation, clearSegCache } from "./_core/masking/segCache";
import type { Sam2Segmentation } from "./_core/masking/replicateSam2";

const bbox = { x: 0.1, y: 0.2, w: 0.5, h: 0.6 };
const seg: Sam2Segmentation = {
  combined: Buffer.from([1, 2, 3]),
  individuals: [Buffer.from([4, 5, 6]), Buffer.from([7, 8, 9])],
};

describe("T3.1: Segmentation cache per (image, bbox)", () => {
  beforeEach(() => {
    clearSegCache();
  });

  it("calls compute on first request, returns cached on second", async () => {
    const compute = vi.fn().mockResolvedValue(seg);

    const first = await cachedSegmentation("https://cdn/img.jpg", bbox, compute);
    expect(compute).toHaveBeenCalledTimes(1);
    expect(first).toEqual(seg);

    const second = await cachedSegmentation("https://cdn/img.jpg", bbox, compute);
    expect(compute).toHaveBeenCalledTimes(1); // NOT called again
    expect(second).toEqual(seg);
    // Byte-identical
    expect(second.combined).toBe(first.combined);
  });

  it("different bbox produces a cache miss", async () => {
    const compute = vi.fn().mockResolvedValue(seg);

    await cachedSegmentation("https://cdn/img.jpg", bbox, compute);
    await cachedSegmentation("https://cdn/img.jpg", { x: 0.2, y: 0.3, w: 0.4, h: 0.5 }, compute);
    expect(compute).toHaveBeenCalledTimes(2);
  });

  it("different image URL produces a cache miss", async () => {
    const compute = vi.fn().mockResolvedValue(seg);

    await cachedSegmentation("https://cdn/img1.jpg", bbox, compute);
    await cachedSegmentation("https://cdn/img2.jpg", bbox, compute);
    expect(compute).toHaveBeenCalledTimes(2);
  });

  it("coalesces concurrent identical requests (inflight dedup)", async () => {
    let resolveCompute: (v: Sam2Segmentation) => void;
    const compute = vi.fn().mockImplementation(
      () => new Promise<Sam2Segmentation>((r) => { resolveCompute = r; })
    );

    const p1 = cachedSegmentation("https://cdn/img.jpg", bbox, compute);
    const p2 = cachedSegmentation("https://cdn/img.jpg", bbox, compute);
    expect(compute).toHaveBeenCalledTimes(1); // only one call, not two

    resolveCompute!(seg);
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toEqual(seg);
    expect(r2).toEqual(seg);
  });
});
