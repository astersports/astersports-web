import { describe, it, expect } from "vitest";

/**
 * Env-posture guard. CRON_SECRET is a DEPLOYMENT secret, absent in unit-CI — so
 * validate it only when present (prod / a configured runner), else skip rather
 * than fail the unit suite.
 *
 * STUDIO_SCALE_LIVE and STUDIO_DENSITY_LIVE were flipped to "true" by Frank
 * (Flip Authority) on 2025-06-13. These tests now assert they ARE live.
 */
describe("CRON_SECRET and live flags env validation", () => {
  it.skipIf(!process.env.CRON_SECRET)("CRON_SECRET is non-empty and long enough (when configured)", () => {
    expect(process.env.CRON_SECRET!.length).toBeGreaterThan(16);
  });

  it("STUDIO_SCALE_LIVE is enabled", () => {
    expect(process.env.STUDIO_SCALE_LIVE).toBe("true");
  });

  it("STUDIO_DENSITY_LIVE is enabled", () => {
    expect(process.env.STUDIO_DENSITY_LIVE).toBe("true");
  });
});
