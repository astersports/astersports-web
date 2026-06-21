/**
 * blueNoiseLayout tests (Density v2 / Option B). Produces EXACTLY M even points
 * inside the fabric raster, deterministically, via early-stopped Lloyd relaxation.
 */
import { describe, it, expect } from "vitest";
import { blueNoiseLayout } from "./_core/studio/ops/blueNoiseLayout";
import { computeNNI } from "./_core/studio/eval/densityMetrics";
import type { RasterMask, BBoxNormalized } from "./_core/masking/types";

const W = 128, H = 128;
const fullRaster = (): RasterMask => ({ width: W, height: H, data: new Uint8Array(W * H).fill(255) });
const fullBbox: BBoxNormalized = { x: 0, y: 0, w: 1, h: 1 };

describe("blueNoiseLayout", () => {
  it("produces EXACTLY M points, all inside the fabric raster", () => {
    const raster = fullRaster();
    for (const M of [1, 7, 18, 25, 36]) {
      const pts = blueNoiseLayout(raster, fullBbox, M, { seed: 1 });
      expect(pts.length).toBe(M);
      for (const [x, y] of pts) {
        const xi = Math.round(x), yi = Math.round(y);
        expect(xi).toBeGreaterThanOrEqual(0);
        expect(xi).toBeLessThan(W);
        expect(yi).toBeGreaterThanOrEqual(0);
        expect(yi).toBeLessThan(H);
        expect(raster.data[yi * W + xi]).toBeGreaterThan(127);
      }
    }
  });

  it("is deterministic (same seed -> identical points)", () => {
    const a = blueNoiseLayout(fullRaster(), fullBbox, 25, { seed: 1 });
    const b = blueNoiseLayout(fullRaster(), fullBbox, 25, { seed: 1 });
    expect(a).toEqual(b);
  });

  it("is even (blue-noise): NNI >= 1 (dispersed, not clustered)", () => {
    const raster = fullRaster();
    const pts = blueNoiseLayout(raster, fullBbox, 25, { seed: 1 });
    const nni = computeNNI(pts as Array<[number, number]>, raster.data, W, H);
    expect(nni).toBeGreaterThanOrEqual(1.0);
  });

  it("returns [] for M <= 0 and for an empty raster", () => {
    expect(blueNoiseLayout(fullRaster(), fullBbox, 0)).toEqual([]);
    const empty: RasterMask = { width: W, height: H, data: new Uint8Array(W * H) };
    expect(blueNoiseLayout(empty, fullBbox, 10)).toEqual([]);
  });

  it("confines points to a non-trivial fabric region", () => {
    // Fabric is only the left half; every point must land in it.
    const data = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W / 2; x++) data[y * W + x] = 255;
    const raster: RasterMask = { width: W, height: H, data };
    const bbox: BBoxNormalized = { x: 0, y: 0, w: 0.5, h: 1 };
    const pts = blueNoiseLayout(raster, bbox, 12, { seed: 1 });
    expect(pts.length).toBe(12);
    for (const [x, y] of pts) {
      expect(raster.data[Math.round(y) * W + Math.round(x)]).toBeGreaterThan(127);
    }
  });
});
