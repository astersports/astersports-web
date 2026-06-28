import { describe, it, expect } from "vitest";
import { LandingAgentGuard, dailyTokenCeiling, DENY_MESSAGE, type GuardConfig } from "./guard";
import { DailySpendLedger } from "./spendLedger";
import { SlidingWindowLimiter } from "./rateLimit";

const T0 = Date.UTC(2026, 0, 15, 12, 0, 0);

const cfg = (over: Partial<GuardConfig> = {}): GuardConfig => ({
  chatPerSession: 8,
  chatPerIpHour: 20,
  leadPerIpDay: 3,
  globalCeilingTokens: 1_000_000,
  identityCapTokens: 30_000,
  ...over,
});

const turn = (over: Partial<Parameters<LandingAgentGuard["evaluateChatTurn"]>[0]> = {}) => ({
  ip: "1.1.1.1",
  sessionId: "sess-1",
  estTokens: 100,
  now: T0,
  live: true,
  ...over,
});

describe("LandingAgentGuard.evaluateChatTurn", () => {
  it("denies when the agent is dark (live=false)", () => {
    const g = new LandingAgentGuard(cfg());
    const d = g.evaluateChatTurn(turn({ live: false }));
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe("disabled");
    expect(d.message).toBe(DENY_MESSAGE.disabled);
  });

  it("allows a normal turn", () => {
    const g = new LandingAgentGuard(cfg());
    expect(g.evaluateChatTurn(turn()).allowed).toBe(true);
  });

  it("enforces the per-session chat limit", () => {
    const g = new LandingAgentGuard(cfg({ chatPerSession: 2, chatPerIpHour: 100 }));
    expect(g.evaluateChatTurn(turn()).allowed).toBe(true);
    expect(g.evaluateChatTurn(turn()).allowed).toBe(true);
    const d = g.evaluateChatTurn(turn());
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe("rate_limited");
  });

  it("enforces the per-IP hourly chat limit across sessions", () => {
    const g = new LandingAgentGuard(cfg({ chatPerSession: 100, chatPerIpHour: 2 }));
    expect(g.evaluateChatTurn(turn({ sessionId: "s1" })).allowed).toBe(true);
    expect(g.evaluateChatTurn(turn({ sessionId: "s2" })).allowed).toBe(true);
    // same IP, third session — IP cap trips even though each session is fresh
    expect(g.evaluateChatTurn(turn({ sessionId: "s3" })).reason).toBe("rate_limited");
  });

  // ── Property 2: ceiling independence ──────────────────────────────────────
  it("the global ceiling holds even with effectively-unlimited rate limits", () => {
    // Huge rate limits so the limiter never trips; tiny ceiling so spend must.
    const g = new LandingAgentGuard(
      cfg({ chatPerSession: 1e9, chatPerIpHour: 1e9, globalCeilingTokens: 250, identityCapTokens: 1e9 }),
    );
    expect(g.evaluateChatTurn(turn({ estTokens: 200 })).allowed).toBe(true);
    const d = g.evaluateChatTurn(turn({ estTokens: 200 }));
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe("global_ceiling");
  });

  it("a buggy always-allow limiter still cannot spend past the ceiling", () => {
    // Inject a limiter stub that ALWAYS allows (simulating a limiter bug). The
    // independent ledger must still stop spend at the ceiling.
    const alwaysAllow = {
      check: () => ({ allowed: true, remaining: 1, retryAfterMs: 0 }),
      sweep: () => {},
      reset: () => {},
    } as unknown as SlidingWindowLimiter;
    const g = new LandingAgentGuard(cfg({ globalCeilingTokens: 300 }), {
      sessionLimiter: alwaysAllow,
      ipLimiter: alwaysAllow,
    });
    expect(g.evaluateChatTurn(turn({ estTokens: 300 })).allowed).toBe(true);
    expect(g.evaluateChatTurn(turn({ estTokens: 1 })).reason).toBe("global_ceiling");
  });

  it("attributes a per-identity exhaustion to identity_cap, not global_ceiling", () => {
    const g = new LandingAgentGuard(cfg({ globalCeilingTokens: 1e9, identityCapTokens: 200 }));
    expect(g.evaluateChatTurn(turn({ estTokens: 200 })).allowed).toBe(true);
    expect(g.evaluateChatTurn(turn({ estTokens: 1 })).reason).toBe("identity_cap");
  });

  // ── Property 1: fail closed ───────────────────────────────────────────────
  it("fails CLOSED (deny) if an internal component throws", () => {
    const throwingLedger = {
      tryConsume: () => {
        throw new Error("boom");
      },
      settle: () => {},
      snapshot: () => ({ day: "", globalTokens: 0, globalCeilingTokens: 0 }),
      reset: () => {},
    } as unknown as DailySpendLedger;
    const g = new LandingAgentGuard(cfg(), { ledger: throwingLedger });
    const d = g.evaluateChatTurn(turn());
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe("error");
  });
});

describe("LandingAgentGuard.evaluateLeadCapture", () => {
  it("is a SEPARATE limit from chat — exhausting chat does not block a lead (condition C2a)", () => {
    const g = new LandingAgentGuard(cfg({ chatPerSession: 1, chatPerIpHour: 1, leadPerIpDay: 3 }));
    // burn the chat limit for this IP
    expect(g.evaluateChatTurn(turn()).allowed).toBe(true);
    expect(g.evaluateChatTurn(turn()).allowed).toBe(false);
    // lead capture is unaffected
    expect(g.evaluateLeadCapture({ ip: "1.1.1.1", now: T0, live: true }).allowed).toBe(true);
  });

  it("enforces its own hard per-IP/day cap", () => {
    const g = new LandingAgentGuard(cfg({ leadPerIpDay: 2 }));
    expect(g.evaluateLeadCapture({ ip: "9.9.9.9", now: T0, live: true }).allowed).toBe(true);
    expect(g.evaluateLeadCapture({ ip: "9.9.9.9", now: T0, live: true }).allowed).toBe(true);
    const d = g.evaluateLeadCapture({ ip: "9.9.9.9", now: T0, live: true });
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe("lead_rate_limited");
  });

  it("denies lead capture when dark", () => {
    const g = new LandingAgentGuard(cfg());
    expect(g.evaluateLeadCapture({ ip: "9.9.9.9", now: T0, live: false }).reason).toBe("disabled");
  });
});

describe("dailyTokenCeiling", () => {
  it("converts a $/day budget to a token budget via the $/Mtok knob", () => {
    // $5/day at $1.50/Mtok ≈ 3.33M tokens
    expect(dailyTokenCeiling(5, 1.5)).toBe(3_333_333);
    expect(dailyTokenCeiling(1, 1)).toBe(1_000_000);
  });

  it("never returns below 1 (avoids a zero/negative ceiling locking everyone out incorrectly)", () => {
    expect(dailyTokenCeiling(0, 1.5)).toBe(1);
  });
});
