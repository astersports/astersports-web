import { describe, it, expect } from "vitest";

/**
 * Env-posture guard. CRON_SECRET is a DEPLOYMENT secret, absent in unit-CI — so
 * validate it only when present (prod / a configured runner), else skip rather
 * than fail the unit suite. "Dark" means a flag is not explicitly "true" (unset
 * OR "false"); asserting the literal "false" wrongly failed CI where the var is
 * simply unset.
 *
 * Per CLAUDE.md §1 Flip Authority (HARD RULE) and the dark default posture of
 * §1.5, STUDIO_SCALE_LIVE and STUDIO_DENSITY_LIVE ship dark and stay dark until
 * Frank's env-verified flip after all gates clear. These tests guard that
 * posture; they must NOT be inverted to assert a live posture (see incident
 * #61, the unauthorized go-live flip).
 */
describe("CRON_SECRET and live flags env validation", () => {
  it.skipIf(!process.env.CRON_SECRET)("CRON_SECRET is non-empty and long enough (when configured)", () => {
    expect(process.env.CRON_SECRET!.length).toBeGreaterThan(16);
  });

  it("STUDIO_SCALE_LIVE is dark (not 'true')", () => {
    expect(process.env.STUDIO_SCALE_LIVE).not.toBe("true");
  });

  it("STUDIO_DENSITY_LIVE is dark (not 'true')", () => {
    expect(process.env.STUDIO_DENSITY_LIVE).not.toBe("true");
  });
});
