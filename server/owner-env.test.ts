import { describe, it, expect } from "vitest";

describe("Owner Environment", () => {
  // Env-parity assertion: only meaningful where the owner env is configured.
  // Skipped in a clean environment (CI) where these secrets are absent.
  it.skipIf(!process.env.OWNER_OPEN_ID)("VITE_OWNER_OPEN_ID matches OWNER_OPEN_ID", () => {
    const ownerOpenId = process.env.OWNER_OPEN_ID;
    const viteOwnerOpenId = process.env.VITE_OWNER_OPEN_ID;

    expect(ownerOpenId).toBeTruthy();
    expect(viteOwnerOpenId).toBeTruthy();
    expect(viteOwnerOpenId).toBe(ownerOpenId);
  });
});
