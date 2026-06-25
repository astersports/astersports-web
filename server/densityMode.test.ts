/**
 * Density mode routing (resolveDensityRedistribute). The user picks "respace" (v2,
 * relocate survivors) vs "inplace" (v1, thin where they are); respace is gated by the
 * STUDIO_DENSITY_REDISTRIBUTE flip-authority flag so it can't run un-flipped (§3).
 */
import { describe, it, expect } from "vitest";
import { resolveDensityRedistribute, defaultControls } from "../shared/controls";

describe("resolveDensityRedistribute (flag-gated density mode routing)", () => {
  it("runs v2 respace only when the user picks respace AND the flag is live", () => {
    expect(resolveDensityRedistribute("respace", true)).toBe(true);
    expect(resolveDensityRedistribute("respace", false)).toBe(false); // flag off -> safe v1 fallback
  });

  it("runs v1 thin-in-place whenever the user picks inplace, regardless of the flag", () => {
    expect(resolveDensityRedistribute("inplace", true)).toBe(false);
    expect(resolveDensityRedistribute("inplace", false)).toBe(false);
  });

  it("falls back to the flag's env behaviour when no mode is set (back-compat: old jobs)", () => {
    expect(resolveDensityRedistribute(undefined, true)).toBe(true);
    expect(resolveDensityRedistribute(undefined, false)).toBe(false);
  });

  it("defaults to inplace (the always-safe layout) in the initial controls", () => {
    expect(defaultControls().density.mode).toBe("inplace");
  });
});
