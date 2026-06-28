import { describe, it, expect } from "vitest";
import { isPlusEntitled, canAccessChild } from "./entitlement";
import type { HubUser } from "@/lib/aster";

// Minimal HubUser stub — only `email` matters to the entitlement gate.
const u = (email: string | null | undefined): HubUser => ({ email } as unknown as HubUser);

describe("entitlement — super-admin Plus (child gate stays closed)", () => {
  it("grants the operator Plus but NOT child access (architect A5 — COPPA)", () => {
    expect(isPlusEntitled(u("frank@astersports.co"))).toBe(true);
    expect(canAccessChild(u("frank@astersports.co"))).toBe(false);
  });

  it("normalizes case + surrounding whitespace on the operator email (Plus)", () => {
    expect(isPlusEntitled(u("  Frank@AsterSports.CO "))).toBe(true);
    expect(canAccessChild(u("  Frank@AsterSports.CO "))).toBe(false);
  });

  it("denies Plus for a normal signed-in account", () => {
    expect(isPlusEntitled(u("parent@example.com"))).toBe(false);
    expect(canAccessChild(u("parent@example.com"))).toBe(false);
  });

  it("denies — and never throws — for null user or missing email", () => {
    expect(isPlusEntitled(null)).toBe(false);
    expect(canAccessChild(undefined)).toBe(false);
    expect(isPlusEntitled(u(null))).toBe(false);
    expect(canAccessChild(u(undefined))).toBe(false);
  });

  it("child gate is closed for everyone until COPPA-grade verification lands", () => {
    expect(canAccessChild(u("frank@astersports.co"))).toBe(false);
    expect(canAccessChild(u("anyone@example.com"))).toBe(false);
    expect(canAccessChild(null)).toBe(false);
  });
});
