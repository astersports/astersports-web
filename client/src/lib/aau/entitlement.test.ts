import { describe, it, expect } from "vitest";
import { isPlusEntitled, canAccessChild } from "./entitlement";
import type { HubUser } from "@/lib/aster";

// Minimal HubUser stub — only `email` matters to the entitlement gate.
const u = (email: string | null | undefined): HubUser => ({ email } as unknown as HubUser);

describe("entitlement — super-admin full-access bypass", () => {
  it("grants the operator full access to both gates", () => {
    expect(isPlusEntitled(u("frank@astersports.co"))).toBe(true);
    expect(canAccessChild(u("frank@astersports.co"))).toBe(true);
  });

  it("normalizes case + surrounding whitespace on the operator email", () => {
    expect(isPlusEntitled(u("  Frank@AsterSports.CO "))).toBe(true);
    expect(canAccessChild(u("  Frank@AsterSports.CO "))).toBe(true);
  });

  it("denies a normal signed-in account", () => {
    expect(isPlusEntitled(u("parent@example.com"))).toBe(false);
    expect(canAccessChild(u("parent@example.com"))).toBe(false);
  });

  it("denies — and never throws — for null user or missing email", () => {
    expect(isPlusEntitled(null)).toBe(false);
    expect(canAccessChild(undefined)).toBe(false);
    expect(isPlusEntitled(u(null))).toBe(false);
    expect(canAccessChild(u(undefined))).toBe(false);
  });
});
