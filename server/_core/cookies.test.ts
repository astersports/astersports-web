/**
 * M11 — session cookie attribute tests. Locks the CSRF-relevant attributes:
 * httpOnly, sameSite=lax, and secure derived from the request protocol.
 */
import { describe, it, expect } from "vitest";
import type { Request } from "express";
import { getSessionCookieOptions } from "./cookies";

const reqWith = (over: Partial<Request>) => ({ protocol: "http", headers: {}, ...over }) as Request;

describe("getSessionCookieOptions", () => {
  it("is httpOnly, lax, root path (CSRF-safe defaults)", () => {
    const opts = getSessionCookieOptions(reqWith({}));
    expect(opts.httpOnly).toBe(true);
    expect(opts.sameSite).toBe("lax");
    expect(opts.path).toBe("/");
  });

  it("secure=false on a plain http request", () => {
    expect(getSessionCookieOptions(reqWith({ protocol: "http" })).secure).toBe(false);
  });

  it("secure=true on https", () => {
    expect(getSessionCookieOptions(reqWith({ protocol: "https" })).secure).toBe(true);
  });

  it("secure=true behind an x-forwarded-proto: https proxy", () => {
    const opts = getSessionCookieOptions(reqWith({ protocol: "http", headers: { "x-forwarded-proto": "https" } }));
    expect(opts.secure).toBe(true);
  });
});
