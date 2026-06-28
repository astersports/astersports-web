import { describe, it, expect } from "vitest";
import { SlidingWindowLimiter } from "./rateLimit";

const T0 = 1_700_000_000_000; // fixed epoch for deterministic windows

describe("SlidingWindowLimiter", () => {
  it("allows up to the limit, then denies within the window", () => {
    const lim = new SlidingWindowLimiter(3, 1000);
    expect(lim.check("k", T0).allowed).toBe(true);
    expect(lim.check("k", T0 + 1).allowed).toBe(true);
    expect(lim.check("k", T0 + 2).allowed).toBe(true);
    const denied = lim.check("k", T0 + 3);
    expect(denied.allowed).toBe(false);
    expect(denied.remaining).toBe(0);
  });

  it("reports remaining correctly", () => {
    const lim = new SlidingWindowLimiter(2, 1000);
    expect(lim.check("k", T0).remaining).toBe(1);
    expect(lim.check("k", T0 + 1).remaining).toBe(0);
  });

  it("frees capacity once the oldest hit rolls out of the window", () => {
    const lim = new SlidingWindowLimiter(2, 1000);
    lim.check("k", T0); // expires at T0+1000
    lim.check("k", T0 + 500); // expires at T0+1500
    expect(lim.check("k", T0 + 600).allowed).toBe(false); // both still in window
    // at T0+1001 the first hit has expired → one slot free
    expect(lim.check("k", T0 + 1001).allowed).toBe(true);
  });

  it("a denied attempt does not extend the window (retryAfter tracks oldest real hit)", () => {
    const lim = new SlidingWindowLimiter(1, 1000);
    lim.check("k", T0); // oldest real hit at T0
    const d1 = lim.check("k", T0 + 200); // denied; must not be recorded
    const d2 = lim.check("k", T0 + 400); // denied; retryAfter still keyed to T0
    expect(d1.allowed).toBe(false);
    expect(d2.allowed).toBe(false);
    // window frees exactly 1000ms after the single real hit, regardless of the
    // denied attempts in between
    expect(lim.check("k", T0 + 1001).allowed).toBe(true);
  });

  it("keys are independent", () => {
    const lim = new SlidingWindowLimiter(1, 1000);
    expect(lim.check("a", T0).allowed).toBe(true);
    expect(lim.check("b", T0).allowed).toBe(true);
    expect(lim.check("a", T0 + 1).allowed).toBe(false);
  });

  it("sweep drops fully-expired keys", () => {
    const lim = new SlidingWindowLimiter(1, 1000);
    lim.check("k", T0);
    lim.sweep(T0 + 2000);
    // key was swept, so a fresh hit is allowed
    expect(lim.check("k", T0 + 2001).allowed).toBe(true);
  });
});
