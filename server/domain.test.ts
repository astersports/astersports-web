/**
 * Multi-domain lock helpers (org-redesign step 4). Pure logic — the load-bearing
 * guard is "never auto-lock a public domain".
 */
import { describe, it, expect } from "vitest";
import {
  normalizeDomain,
  extractDomain,
  isPublicEmailDomain,
  autoDomainLockForOwnerEmail,
  emailAllowedForDomains,
  emailAllowedForDomain,
} from "../shared/domain";

describe("normalizeDomain", () => {
  it("strips @, lowercases, trims, and accepts full emails", () => {
    expect(normalizeDomain("@Jaya.com")).toBe("jaya.com");
    expect(normalizeDomain("  JAYA.com  ")).toBe("jaya.com");
    expect(normalizeDomain("jhanson@Jaya.com")).toBe("jaya.com");
    expect(normalizeDomain(null)).toBe("");
    expect(normalizeDomain(undefined)).toBe("");
  });
});

describe("extractDomain", () => {
  it("returns the lowercased domain or empty for malformed input", () => {
    expect(extractDomain("a@JAYA.com")).toBe("jaya.com");
    expect(extractDomain("nope")).toBe("");
    expect(extractDomain("a@b@c")).toBe("");
  });
});

describe("isPublicEmailDomain", () => {
  it("flags consumer providers, not company domains", () => {
    for (const d of ["gmail.com", "outlook.com", "icloud.com", "proton.me", "yahoo.com"]) {
      expect(isPublicEmailDomain(d)).toBe(true);
    }
    expect(isPublicEmailDomain("jaya.com")).toBe(false);
    expect(isPublicEmailDomain("cinqasept.nyc")).toBe(false);
    expect(isPublicEmailDomain("@GMAIL.com")).toBe(true); // normalized
  });
});

describe("autoDomainLockForOwnerEmail — the public-domain guard", () => {
  it("seeds the company domain for a corporate owner", () => {
    expect(autoDomainLockForOwnerEmail("jhanson@jaya.com")).toBe("jaya.com");
  });
  it("returns null for a public-provider owner (never auto-lock → invite-only)", () => {
    expect(autoDomainLockForOwnerEmail("someone@gmail.com")).toBeNull();
    expect(autoDomainLockForOwnerEmail("someone@outlook.com")).toBeNull();
  });
  it("returns null for malformed/empty input", () => {
    expect(autoDomainLockForOwnerEmail("")).toBeNull();
    expect(autoDomainLockForOwnerEmail("not-an-email")).toBeNull();
    expect(autoDomainLockForOwnerEmail(null)).toBeNull();
  });
});

describe("emailAllowedForDomains — set-aware", () => {
  const set = ["jaya.com", "cinqasept.nyc", "likely.nyc"];
  it("empty/absent set allows all (per-email invites still govern)", () => {
    expect(emailAllowedForDomains("x@anything.com", [])).toBe(true);
    expect(emailAllowedForDomains("x@anything.com", null)).toBe(true);
  });
  it("allows any domain in the set, rejects others", () => {
    expect(emailAllowedForDomains("a@jaya.com", set)).toBe(true);
    expect(emailAllowedForDomains("b@cinqasept.nyc", set)).toBe(true);
    expect(emailAllowedForDomains("c@likely.nyc", set)).toBe(true);
    expect(emailAllowedForDomains("d@evil.com", set)).toBe(false);
  });
  it("normalizes set entries and is case-insensitive", () => {
    expect(emailAllowedForDomains("A@JAYA.com", ["@Jaya.com"])).toBe(true);
  });
  it("rejects when email is missing but a lock exists", () => {
    expect(emailAllowedForDomains(null, set)).toBe(false);
  });
});

describe("emailAllowedForDomain — legacy single-domain (back-compat)", () => {
  it("null allows all; otherwise exact domain suffix", () => {
    expect(emailAllowedForDomain("x@whatever.com", null)).toBe(true);
    expect(emailAllowedForDomain("x@jaya.com", "jaya.com")).toBe(true);
    expect(emailAllowedForDomain("x@evil.com", "jaya.com")).toBe(false);
    expect(emailAllowedForDomain(null, "jaya.com")).toBe(false);
  });
});
