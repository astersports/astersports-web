import { describe, it, expect } from "vitest";

/**
 * Validates that the STUDIO_SCALE_LIVE and STUDIO_DENSITY_LIVE feature flags
 * are correctly set in the environment, enabling the deterministic pipelines.
 */
describe("Studio Live Feature Flags", () => {
  it("STUDIO_SCALE_LIVE is set to true", () => {
    expect(process.env.STUDIO_SCALE_LIVE).toBe("true");
  });

  it("STUDIO_DENSITY_LIVE is set to true", () => {
    expect(process.env.STUDIO_DENSITY_LIVE).toBe("true");
  });

  it("STUDIO_MASK_PROVIDER is set to sam2", () => {
    expect(process.env.STUDIO_MASK_PROVIDER).toBe("sam2");
  });

  it("REPLICATE_API_TOKEN is non-empty", () => {
    expect(process.env.REPLICATE_API_TOKEN).toBeTruthy();
    expect(process.env.REPLICATE_API_TOKEN!.length).toBeGreaterThan(10);
  });

  it("REPLICATE_SAM2_MODEL is non-empty", () => {
    expect(process.env.REPLICATE_SAM2_MODEL).toBeTruthy();
    expect(process.env.REPLICATE_SAM2_MODEL).toContain("sam-2");
  });
});
