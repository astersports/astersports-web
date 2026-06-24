/**
 * SPIKE: proves the FLUX.1 Fill provider's CRITICAL invariant deterministically, with NO model
 * call — pixel-identity outside the SAM2 mask. The research flagged this as the one mandatory
 * addition over LaMa: a latent-diffusion decode shifts colour/adds seams globally, so we must
 * paste back ONLY the masked region over the original. These tests pin that guarantee.
 */
import { describe, it, expect } from "vitest";
import { compositeUnderMask, buildFluxCacheKey } from "./_core/studio/ops/fluxFill";
import type { RasterMask } from "./_core/masking/types";

const W = 4, H = 4, N = W * H;

/** Solid RGBA fill helper. */
function solid(r: number, g: number, b: number, a = 255): Buffer {
  const buf = Buffer.alloc(N * 4);
  for (let i = 0; i < N; i++) {
    buf[i * 4] = r; buf[i * 4 + 1] = g; buf[i * 4 + 2] = b; buf[i * 4 + 3] = a;
  }
  return buf;
}

function mask(setIdx: number[]): RasterMask {
  const data = new Uint8Array(N);
  for (const i of setIdx) data[i] = 255;
  return { data, width: W, height: H };
}

describe("fluxFill.compositeUnderMask — pixel-identity outside the mask", () => {
  const original = solid(0, 0, 255); // blue
  const filled = solid(255, 0, 0); // red (stands in for FLUX's full-frame decode)

  it("uses the model's pixels INSIDE the mask and the original's OUTSIDE it", () => {
    const region = mask([5, 6]); // two interior pixels marked for fill
    const out = compositeUnderMask(original, filled, region, W, H);
    for (let i = 0; i < N; i++) {
      const p = i * 4;
      if (i === 5 || i === 6) {
        expect([out[p], out[p + 1], out[p + 2]]).toEqual([255, 0, 0]); // red (filled)
      } else {
        expect([out[p], out[p + 1], out[p + 2]]).toEqual([0, 0, 255]); // blue (original, untouched)
      }
    }
  });

  it("is byte-identical to the original when the mask is empty (no fill region)", () => {
    const out = compositeUnderMask(original, filled, mask([]), W, H);
    expect(Buffer.compare(out, original)).toBe(0);
  });

  it("never mutates the input original buffer", () => {
    const orig = solid(10, 20, 30);
    const snapshot = Buffer.from(orig);
    compositeUnderMask(orig, filled, mask([0, 1, 2]), W, H);
    expect(Buffer.compare(orig, snapshot)).toBe(0);
  });

  it("preserves the model's alpha channel inside the mask", () => {
    const semiTransparent = solid(255, 0, 0, 128);
    const out = compositeUnderMask(original, semiTransparent, mask([0]), W, H);
    expect(out[3]).toBe(128); // pixel 0 alpha from the fill
    expect(out[7]).toBe(255); // pixel 1 alpha from the original (outside mask)
  });
});

describe("fluxFill.buildFluxCacheKey — reproducible-by-content", () => {
  const img = solid(1, 2, 3);
  it("is stable for identical inputs (so undo/redo hits cache)", () => {
    expect(buildFluxCacheKey(img, mask([1]), 1)).toBe(buildFluxCacheKey(img, mask([1]), 1));
  });
  it("changes with the seed and with the mask", () => {
    expect(buildFluxCacheKey(img, mask([1]), 1)).not.toBe(buildFluxCacheKey(img, mask([1]), 2));
    expect(buildFluxCacheKey(img, mask([1]), 1)).not.toBe(buildFluxCacheKey(img, mask([2]), 1));
  });
});
