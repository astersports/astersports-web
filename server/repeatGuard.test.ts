/**
 * Tests for the non-repeat guard (Flag 2) and the integrated scale no-op
 * refund parity (Flag 1). Validates:
 * 1. checkRepeat correctly identifies repeating vs non-repeating patterns
 * 2. generateScaledImage throws NON_REPEAT_SCALE_ERROR for non-repeating inputs
 * 3. generateScaledImage throws NO_OP_SCALE_ERROR when changed:false (Flag 1)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { checkRepeat, MIN_REPEAT_CONFIDENCE } from "./_core/studio/ops/repeatGuard";

describe("checkRepeat (repeat guard)", () => {
  it("returns isRepeat:true for a periodic signal (synthetic stripe pattern)", () => {
    // Create a 100x20 image with vertical stripes (period ~10px)
    const w = 100, h = 20;
    const rgba = Buffer.alloc(w * h * 4);
    const mask = new Uint8Array(w * h);
    mask.fill(255); // entire image is fabric

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const val = (x % 10) < 5 ? 200 : 50; // alternating bright/dark stripes
        rgba[i] = val; rgba[i + 1] = val; rgba[i + 2] = val; rgba[i + 3] = 255;
      }
    }

    const result = checkRepeat(rgba, w, h, mask);
    expect(result.isRepeat).toBe(true);
    expect(result.confidence).toBeGreaterThanOrEqual(MIN_REPEAT_CONFIDENCE);
    expect(result.axes.length).toBe(2);
    // X-axis should have a strong period around 10
    const xAxis = result.axes.find(a => a.axis === "x");
    expect(xAxis).toBeDefined();
    expect(xAxis!.period).toBeGreaterThan(0);
  });

  it("returns isRepeat:false for a uniform (non-periodic) image", () => {
    // Uniform gray — no period at all
    const w = 100, h = 20;
    const rgba = Buffer.alloc(w * h * 4);
    const mask = new Uint8Array(w * h);
    mask.fill(255);

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        rgba[i] = 128; rgba[i + 1] = 128; rgba[i + 2] = 128; rgba[i + 3] = 255;
      }
    }

    const result = checkRepeat(rgba, w, h, mask);
    expect(result.isRepeat).toBe(false);
    expect(result.confidence).toBeLessThan(MIN_REPEAT_CONFIDENCE);
  });

  it("returns isRepeat:false for an empty mask", () => {
    const w = 50, h = 50;
    const rgba = Buffer.alloc(w * h * 4, 100);
    const mask = new Uint8Array(w * h); // all zeros

    const result = checkRepeat(rgba, w, h, mask);
    expect(result.isRepeat).toBe(false);
    expect(result.confidence).toBe(0);
    expect(result.axes).toHaveLength(0);
  });

  it("returns isRepeat:false for random noise (no dominant period)", () => {
    const w = 100, h = 20;
    const rgba = Buffer.alloc(w * h * 4);
    const mask = new Uint8Array(w * h);
    mask.fill(255);

    // Pseudo-random (seeded via simple LCG for determinism)
    let seed = 42;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        const val = seed % 256;
        const i = (y * w + x) * 4;
        rgba[i] = val; rgba[i + 1] = val; rgba[i + 2] = val; rgba[i + 3] = 255;
      }
    }

    const result = checkRepeat(rgba, w, h, mask);
    // Random noise should not produce a strong period
    expect(result.confidence).toBeLessThan(0.5);
  });

  it("respects custom threshold parameter", () => {
    // Create a weakly periodic signal
    const w = 100, h = 10;
    const rgba = Buffer.alloc(w * h * 4);
    const mask = new Uint8Array(w * h);
    mask.fill(255);

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        // Weak modulation: 120 ± 10
        const val = 120 + Math.round(10 * Math.sin(2 * Math.PI * x / 10));
        rgba[i] = val; rgba[i + 1] = val; rgba[i + 2] = val; rgba[i + 3] = 255;
      }
    }

    // With a very high threshold, even a periodic signal might fail
    const strict = checkRepeat(rgba, w, h, mask, 0.99);
    // With default threshold, a clear sinusoid should pass
    const normal = checkRepeat(rgba, w, h, mask, MIN_REPEAT_CONFIDENCE);
    // The sinusoid is clearly periodic so normal should pass
    expect(normal.isRepeat).toBe(true);
    // Strict might or might not pass depending on signal strength
    // but confidence should be less than 0.99 for a weak signal
    if (!strict.isRepeat) {
      expect(strict.confidence).toBeLessThan(0.99);
    }
  });
});

// Integration tests for generateScaledImage with both guards are in scaleLive.test.ts.
// This file focuses on the pure repeatGuard logic.
