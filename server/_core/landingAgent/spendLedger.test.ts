import { describe, it, expect } from "vitest";
import { DailySpendLedger } from "./spendLedger";

const T0 = Date.UTC(2026, 0, 15, 12, 0, 0); // 2026-01-15T12:00:00Z
const NEXT_DAY = Date.UTC(2026, 0, 16, 0, 0, 1); // just past UTC midnight

describe("DailySpendLedger", () => {
  it("allows spend up to the global ceiling, then denies", () => {
    // identity cap set high so the GLOBAL ceiling is the binding limit here
    const led = new DailySpendLedger(1000, 1_000_000);
    expect(led.tryConsume("ip-a", 600, T0).allowed).toBe(true);
    expect(led.tryConsume("ip-a", 400, T0).allowed).toBe(true); // total 1000 == ceiling
    const over = led.tryConsume("ip-a", 1, T0);
    expect(over.allowed).toBe(false);
    expect(over.reason).toBe("global_ceiling");
  });

  it("enforces the per-identity cap before the global ceiling (condition C3)", () => {
    // global has plenty of room (10k); identity cap is small (1k)
    const led = new DailySpendLedger(10_000, 1000);
    expect(led.tryConsume("ip-a", 1000, T0).allowed).toBe(true);
    const capped = led.tryConsume("ip-a", 1, T0);
    expect(capped.allowed).toBe(false);
    expect(capped.reason).toBe("identity_cap"); // not global_ceiling
  });

  it("one actor at its cap does NOT deny other actors (condition C3 — no DoS)", () => {
    const led = new DailySpendLedger(10_000, 1000);
    // ip-a exhausts its 1k slice
    expect(led.tryConsume("ip-a", 1000, T0).allowed).toBe(true);
    expect(led.tryConsume("ip-a", 1, T0).allowed).toBe(false);
    // ip-b is unaffected — the global pool still has room and its own slice is fresh
    expect(led.tryConsume("ip-b", 1000, T0).allowed).toBe(true);
    expect(led.tryConsume("ip-c", 1000, T0).allowed).toBe(true);
  });

  it("the global ceiling can still be reached across many identities (backstop)", () => {
    const led = new DailySpendLedger(2500, 1000);
    expect(led.tryConsume("ip-a", 1000, T0).allowed).toBe(true);
    expect(led.tryConsume("ip-b", 1000, T0).allowed).toBe(true);
    // ip-c's slice is fresh, but only 500 of the global pool remains
    expect(led.tryConsume("ip-c", 1000, T0).reason).toBe("global_ceiling");
    expect(led.tryConsume("ip-c", 500, T0).allowed).toBe(true);
  });

  it("does not record tokens on a denied attempt", () => {
    const led = new DailySpendLedger(1000, 1000);
    expect(led.tryConsume("ip-a", 1001, T0).allowed).toBe(false); // over ceiling
    // the failed 1001 must not have been counted — a 1000 request still fits
    expect(led.tryConsume("ip-a", 1000, T0).allowed).toBe(true);
  });

  it("resets both counters at the UTC day rollover", () => {
    const led = new DailySpendLedger(1000, 1000);
    expect(led.tryConsume("ip-a", 1000, T0).allowed).toBe(true);
    expect(led.tryConsume("ip-a", 1, T0).allowed).toBe(false);
    // next UTC day → fresh budget
    expect(led.tryConsume("ip-a", 1000, NEXT_DAY).allowed).toBe(true);
    expect(led.snapshot(NEXT_DAY).globalTokens).toBe(1000);
  });

  it("settle reconciles actual vs estimate and never goes negative", () => {
    const led = new DailySpendLedger(1000, 1000);
    led.tryConsume("ip-a", 500, T0); // reserved 500
    led.settle("ip-a", -200, T0); // actual was 300 → free 200
    expect(led.snapshot(T0).globalTokens).toBe(300);
    led.settle("ip-a", -9999, T0); // clamp, never negative
    expect(led.snapshot(T0).globalTokens).toBe(0);
  });
});
