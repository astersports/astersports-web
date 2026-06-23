/**
 * T2.3 — blueNoiseLayout tests (Bridson Poisson-disk sampling + Yuksel elimination).
 * Produces EXACTLY M even points inside the fabric raster, deterministically.
 *
 * Upgraded from Lloyd-relaxation to Bridson 2007 + Yuksel 2015 for correct
 * blue-noise spectrum without over-regularization.
 */
import { describe, it, expect } from "vitest";
import { blueNoiseLayout } from "./_core/studio/ops/blueNoiseLayout";
import { computeNNI } from "./_core/studio/eval/densityMetrics";
import type { RasterMask, BBoxNormalized } from "./_core/masking/types";

const W = 128, H = 128;
const fullRaster = (): RasterMask => ({ width: W, height: H, data: new Uint8Array(W * H).fill(255) });
const fullBbox: BBoxNormalized = { x: 0, y: 0, w: 1, h: 1 };

describe("blueNoiseLayout (Bridson + Yuksel)", () => {
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

  it("different seeds produce different output", () => {
    const a = blueNoiseLayout(fullRaster(), fullBbox, 25, { seed: 1 });
    const b = blueNoiseLayout(fullRaster(), fullBbox, 25, { seed: 2 });
    expect(a).not.toEqual(b);
  });

  it("is even (blue-noise): NNI in [1.0, 1.9] band (dispersed, not lattice)", () => {
    const raster = fullRaster();
    const pts = blueNoiseLayout(raster, fullBbox, 25, { seed: 1 });
    const nni = computeNNI(pts as Array<[number, number]>, raster.data, W, H);
    expect(nni).toBeGreaterThanOrEqual(1.0);
    expect(nni).toBeLessThanOrEqual(1.9);
  });

  it("NNI stays organic (< 1.9) even with larger point counts", () => {
    const raster: RasterMask = { width: 256, height: 256, data: new Uint8Array(256 * 256).fill(255) };
    const pts = blueNoiseLayout(raster, fullBbox, 50, { seed: 3 });
    const nni = computeNNI(pts as Array<[number, number]>, raster.data, 256, 256);
    expect(nni).toBeGreaterThanOrEqual(1.0);
    expect(nni).toBeLessThanOrEqual(1.9);
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

  it("maintains minimum spacing between points", () => {
    const raster = fullRaster();
    const m = 25;
    const pts = blueNoiseLayout(raster, fullBbox, m, { seed: 1 });
    const area = W * H;
    const expectedR = Math.sqrt((2 * area) / (Math.sqrt(3) * m));
    const minAllowed = expectedR * 0.25; // generous lower bound

    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        const d = Math.sqrt((pts[i][0] - pts[j][0]) ** 2 + (pts[i][1] - pts[j][1]) ** 2);
        expect(d).toBeGreaterThan(minAllowed);
      }
    }
  });

  it("handles circular fabric region correctly", () => {
    // Circular fabric (radius 40 in a 128x128 raster)
    const data = new Uint8Array(W * H);
    const cx = W / 2, cy = H / 2, r = 40;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if ((x - cx) ** 2 + (y - cy) ** 2 < r * r) data[y * W + x] = 255;
      }
    }
    const raster: RasterMask = { width: W, height: H, data };
    const pts = blueNoiseLayout(raster, fullBbox, 15, { seed: 5 });
    expect(pts.length).toBe(15);
    for (const [x, y] of pts) {
      expect(raster.data[Math.round(y) * W + Math.round(x)]).toBeGreaterThan(127);
    }
  });
});
