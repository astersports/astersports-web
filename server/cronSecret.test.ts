import { describe, it, expect } from "vitest";

describe("CRON_SECRET and live flags env validation", () => {
  it("CRON_SECRET is set and non-empty", () => {
    const secret = process.env.CRON_SECRET;
    expect(secret).toBeDefined();
    expect(secret!.length).toBeGreaterThan(16);
  });

  it("STUDIO_SCALE_LIVE is false (dark)", () => {
    const val = process.env.STUDIO_SCALE_LIVE;
    expect(val).toBe("false");
  });

  it("STUDIO_DENSITY_LIVE is false (dark)", () => {
    const val = process.env.STUDIO_DENSITY_LIVE;
    expect(val).toBe("false");
  });
});
