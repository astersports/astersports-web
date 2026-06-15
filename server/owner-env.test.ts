import { describe, it, expect } from "vitest";

describe("Owner Environment", () => {
  it("VITE_OWNER_OPEN_ID matches OWNER_OPEN_ID", () => {
    const ownerOpenId = process.env.OWNER_OPEN_ID;
    const viteOwnerOpenId = process.env.VITE_OWNER_OPEN_ID;

    expect(ownerOpenId).toBeTruthy();
    expect(viteOwnerOpenId).toBeTruthy();
    expect(viteOwnerOpenId).toBe(ownerOpenId);
  });
});
