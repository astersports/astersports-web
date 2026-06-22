/**
 * validateEnv — the boot-time fail-fast guards. ENV is built from process.env at
 * module load, so each case sets process.env then dynamic-imports a fresh module.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const SAM2_REQUIRED = /require STUDIO_MASK_PROVIDER=sam2/;

describe("validateEnv — live scale/density flags require sam2 (B5)", () => {
  const OLD = process.env;
  beforeEach(() => {
    vi.resetModules();
    process.env = { ...OLD };
  });
  afterEach(() => {
    process.env = OLD;
  });

  async function errorsFor(env: Record<string, string>): Promise<string[]> {
    Object.assign(process.env, env);
    const mod = await import("./_core/env");
    return mod.validateEnv().errors;
  }

  it("errors when STUDIO_DENSITY_LIVE=true without sam2", async () => {
    const errors = await errorsFor({ STUDIO_DENSITY_LIVE: "true", STUDIO_MASK_PROVIDER: "classical" });
    expect(errors.some((e) => SAM2_REQUIRED.test(e))).toBe(true);
  });

  it("errors when STUDIO_SCALE_LIVE=true without sam2", async () => {
    const errors = await errorsFor({ STUDIO_SCALE_LIVE: "true", STUDIO_MASK_PROVIDER: "classical" });
    expect(errors.some((e) => SAM2_REQUIRED.test(e))).toBe(true);
  });

  it("does NOT error when the live flags are dark (classical default)", async () => {
    const errors = await errorsFor({ STUDIO_SCALE_LIVE: "false", STUDIO_DENSITY_LIVE: "false", STUDIO_MASK_PROVIDER: "classical" });
    expect(errors.some((e) => SAM2_REQUIRED.test(e))).toBe(false);
  });

  it("does NOT error when live + sam2 + replicate creds present", async () => {
    const errors = await errorsFor({
      STUDIO_SCALE_LIVE: "true",
      STUDIO_DENSITY_LIVE: "true",
      STUDIO_MASK_PROVIDER: "sam2",
      REPLICATE_API_TOKEN: "tok-xxxxxxxxxx",
      REPLICATE_SAM2_MODEL: "meta/sam-2",
    });
    expect(errors.some((e) => SAM2_REQUIRED.test(e))).toBe(false);
  });
});
