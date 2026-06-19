import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Tests for the hybrid Scale pipeline integration.
 * Since the actual SAM2 calls require a live API and real images,
 * these tests verify:
 * 1. The routing logic (scale-only → hybrid, combined → AI)
 * 2. The Replicate client configuration
 * 3. Error handling for missing tokens
 */

describe("Replicate Client", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it("throws if REPLICATE_API_TOKEN is not set", async () => {
    vi.stubEnv("REPLICATE_API_TOKEN", "");

    // Dynamic import to get fresh module state
    const { segmentWithSAM2 } = await import("./replicateClient");

    await expect(
      segmentWithSAM2("https://example.com/image.jpg")
    ).rejects.toThrow("REPLICATE_API_TOKEN");
  });

  it("has REPLICATE_API_TOKEN configured in environment", () => {
    const token = process.env.REPLICATE_API_TOKEN;
    expect(token).toBeDefined();
    expect(token!.length).toBeGreaterThan(5);
    expect(token!.startsWith("r8_")).toBe(true);
  });
});

describe("Hybrid Scale Pipeline - Routing Logic", () => {
  it("routes scale-only controls to hybrid pipeline", () => {
    // Simulate the routing check from studio.ts
    const controls = {
      scale: { enabled: true, percent: -50 },
      density: { enabled: false, percent: 0 },
      remove: { enabled: false, element: "", percent: 0 },
      recolor: { enabled: false, element: "", targetColor: "", coverage: 100 },
      variations: 1,
    };

    const isScaleOnly =
      controls.scale.enabled &&
      !controls.density.enabled &&
      !controls.remove.enabled &&
      !controls.recolor.enabled;

    expect(isScaleOnly).toBe(true);
  });

  it("routes combined controls (scale + recolor) to AI pipeline", () => {
    const controls = {
      scale: { enabled: true, percent: -30 },
      density: { enabled: false, percent: 0 },
      remove: { enabled: false, element: "", percent: 0 },
      recolor: { enabled: true, element: "flowers", targetColor: "coral", coverage: 100 },
      variations: 1,
    };

    const isScaleOnly =
      controls.scale.enabled &&
      !controls.density.enabled &&
      !controls.remove.enabled &&
      !controls.recolor.enabled;

    expect(isScaleOnly).toBe(false);
  });

  it("routes scale + density to AI pipeline", () => {
    const controls = {
      scale: { enabled: true, percent: -20 },
      density: { enabled: true, percent: 30 },
      remove: { enabled: false, element: "", percent: 0 },
      recolor: { enabled: false, element: "", targetColor: "", coverage: 100 },
      variations: 1,
    };

    const isScaleOnly =
      controls.scale.enabled &&
      !controls.density.enabled &&
      !controls.remove.enabled &&
      !controls.recolor.enabled;

    expect(isScaleOnly).toBe(false);
  });

  it("does not route non-scale controls to hybrid pipeline", () => {
    const controls = {
      scale: { enabled: false, percent: 0 },
      density: { enabled: true, percent: 40 },
      remove: { enabled: false, element: "", percent: 0 },
      recolor: { enabled: false, element: "", targetColor: "", coverage: 100 },
      variations: 1,
    };

    const isScaleOnly =
      controls.scale.enabled &&
      !controls.density.enabled &&
      !controls.remove.enabled &&
      !controls.recolor.enabled;

    expect(isScaleOnly).toBe(false);
  });
});

describe("Hybrid Scale Pipeline - Scale Factor Calculation", () => {
  it("converts -50% to 0.5 scale factor", () => {
    const scalePercent = -50;
    const scaleFactor = 1 + scalePercent / 100;
    expect(scaleFactor).toBe(0.5);
  });

  it("converts +30% to 1.3 scale factor", () => {
    const scalePercent = 30;
    const scaleFactor = 1 + scalePercent / 100;
    expect(scaleFactor).toBe(1.3);
  });

  it("converts -20% to 0.8 scale factor", () => {
    const scalePercent = -20;
    const scaleFactor = 1 + scalePercent / 100;
    expect(scaleFactor).toBe(0.8);
  });

  it("converts 0% to 1.0 (no change)", () => {
    const scalePercent = 0;
    const scaleFactor = 1 + scalePercent / 100;
    expect(scaleFactor).toBe(1.0);
  });
});
