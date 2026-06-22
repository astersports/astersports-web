import { describe, it, expect } from "vitest";

/**
 * Env-posture guard. CRON_SECRET is a DEPLOYMENT secret, absent in unit-CI — so
 * validate it only when present (prod / a configured runner), else skip rather
 * than fail the unit suite.
 *
 * G1 FLIP (Frank, 2026-06-22): Scale, Density, and Redistribute all authorized
 * LIVE for production testing. The async refactor (PRs #82–#86) was specifically
 * built to give headroom for the v2 redistribute path.
 *
 * Site is not public yet — testing in prod.
 *
 * These tests validate env format when present, and confirm CRON_SECRET integrity.
 */
describe("CRON_SECRET and live flags env validation", () => {
  it.skipIf(!process.env.CRON_SECRET)("CRON_SECRET is non-empty and long enough (when configured)", () => {
    expect(process.env.CRON_SECRET!.length).toBeGreaterThan(16);
  });

  it("STUDIO_SCALE_LIVE is defined when env is configured", () => {
    // In CI the var may be unset; in prod it should be "true" per G1 flip
    if (process.env.STUDIO_SCALE_LIVE) {
      expect(["true", "false"]).toContain(process.env.STUDIO_SCALE_LIVE);
    }
  });

  it("STUDIO_DENSITY_LIVE is defined when env is configured", () => {
    if (process.env.STUDIO_DENSITY_LIVE) {
      expect(["true", "false"]).toContain(process.env.STUDIO_DENSITY_LIVE);
    }
  });

  it("STUDIO_DENSITY_REDISTRIBUTE is valid when env is configured", () => {
    // Frank authorized redistribute=true for async go-live (2026-06-22).
    // The async refactor gives headroom for the v2 redistribute path.
    if (process.env.STUDIO_DENSITY_REDISTRIBUTE) {
      expect(["true", "false"]).toContain(process.env.STUDIO_DENSITY_REDISTRIBUTE);
    }
  });
});
