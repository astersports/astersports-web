/**
 * Landing agent abuse/cost guard (docs/SPEC_LANDING_AGENT.txt §5, P2).
 *
 * Composes the sliding-window rate limiter (per-session + per-IP chat limits, and
 * a SEPARATE per-IP/day lead-capture limit — condition C2a) with the daily spend
 * ledger (per-identity cap + global ceiling — condition C3). The P3 endpoint
 * calls `evaluateChatTurn` before any model call and `evaluateLeadCapture` before
 * any email send.
 *
 * Two safety properties this module guarantees:
 *  1. Fail closed. Any internal error → DENY (never allow on error).
 *  2. Ceiling independence. The spend ledger is checked independently of the rate
 *     limiter, so a buggy/over-permissive limiter still cannot spend past the
 *     global ceiling. (Tested: huge rate limits + tiny ceiling still denies.)
 *
 * Nothing imports this yet — it is dark until P3 wires the endpoint.
 */

import { ENV } from "../env";
import { SlidingWindowLimiter } from "./rateLimit";
import { DailySpendLedger, type SpendDenyReason } from "./spendLedger";

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
/** A session is ephemeral; a 6h window effectively bounds it to its lifetime. */
const SESSION_WINDOW_MS = 6 * HOUR_MS;

export type DenyReason =
  | "disabled"
  | "rate_limited"
  | "lead_rate_limited"
  | SpendDenyReason // "identity_cap" | "global_ceiling"
  | "error";

export interface GuardDecision {
  allowed: boolean;
  reason?: DenyReason;
  /** Kind, actionable microcopy for the UI when denied (never a raw error). */
  message?: string;
}

/** Kindness microcopy — every denial points the visitor at the contact form. */
export const DENY_MESSAGE: Record<DenyReason, string> = {
  disabled: "The scout is offline right now — drop us a note on the contact form and we'll reply by email.",
  rate_limited: "Let's keep this short — for anything more, the contact form reaches us directly.",
  lead_rate_limited: "Looks like that already came through. We'll be in touch — no need to resend.",
  identity_cap: "We've chatted a fair bit today — the contact form is the fastest way to reach a human from here.",
  global_ceiling: "The scout is resting for now. Leave a note on the contact form and we'll get right back to you.",
  error: "Something hiccuped on our end. The contact form will reach us directly.",
};

export interface GuardConfig {
  chatPerSession: number;
  chatPerIpHour: number;
  leadPerIpDay: number;
  globalCeilingTokens: number;
  identityCapTokens: number;
}

export interface ChatTurnInput {
  ip: string;
  sessionId: string;
  /** Estimated tokens this turn will spend (input + max output). */
  estTokens: number;
  /** Injected clock (ms epoch). */
  now: number;
  /** ENV.landingAgentLive — passed in so the guard stays env-free + testable. */
  live: boolean;
}

export interface LeadCaptureInput {
  ip: string;
  now: number;
  live: boolean;
}

/** Optional component injection for tests (e.g. a ledger stub that throws). */
export interface GuardDeps {
  sessionLimiter?: SlidingWindowLimiter;
  ipLimiter?: SlidingWindowLimiter;
  leadLimiter?: SlidingWindowLimiter;
  ledger?: DailySpendLedger;
}

function deny(reason: DenyReason): GuardDecision {
  return { allowed: false, reason, message: DENY_MESSAGE[reason] };
}

export class LandingAgentGuard {
  private readonly sessionLimiter: SlidingWindowLimiter;
  private readonly ipLimiter: SlidingWindowLimiter;
  private readonly leadLimiter: SlidingWindowLimiter;
  private readonly ledger: DailySpendLedger;

  constructor(cfg: GuardConfig, deps: GuardDeps = {}) {
    this.sessionLimiter = deps.sessionLimiter ?? new SlidingWindowLimiter(cfg.chatPerSession, SESSION_WINDOW_MS);
    this.ipLimiter = deps.ipLimiter ?? new SlidingWindowLimiter(cfg.chatPerIpHour, HOUR_MS);
    this.leadLimiter = deps.leadLimiter ?? new SlidingWindowLimiter(cfg.leadPerIpDay, DAY_MS);
    this.ledger = deps.ledger ?? new DailySpendLedger(cfg.globalCeilingTokens, cfg.identityCapTokens);
  }

  /**
   * Gate a chat turn. Order: dark check → rate limits → spend. The spend ledger
   * is evaluated independently of the limiters (property 2), and the whole body
   * is wrapped so any throw fails closed (property 1).
   */
  evaluateChatTurn(input: ChatTurnInput): GuardDecision {
    try {
      if (!input.live) return deny("disabled");

      if (!this.sessionLimiter.check(`sess:${input.sessionId}`, input.now).allowed) {
        return deny("rate_limited");
      }
      if (!this.ipLimiter.check(`ip:${input.ip}`, input.now).allowed) {
        return deny("rate_limited");
      }

      const spend = this.ledger.tryConsume(input.ip, input.estTokens, input.now);
      if (!spend.allowed) return deny(spend.reason ?? "global_ceiling");

      return { allowed: true };
    } catch {
      return deny("error"); // fail closed
    }
  }

  /**
   * Reconcile actual vs estimated tokens after a turn completes (the route calls
   * this with the real usage from the model response).
   */
  settleChatTurn(ip: string, deltaTokens: number, now: number): void {
    try {
      this.ledger.settle(ip, deltaTokens, now);
    } catch {
      /* settle is best-effort accounting; never throw into the request path */
    }
  }

  /** Gate a lead-capture submit — a SEPARATE, hard per-IP/day cap (condition C2a). */
  evaluateLeadCapture(input: LeadCaptureInput): GuardDecision {
    try {
      if (!input.live) return deny("disabled");
      if (!this.leadLimiter.check(`lead:${input.ip}`, input.now).allowed) {
        return deny("lead_rate_limited");
      }
      return { allowed: true };
    } catch {
      return deny("error"); // fail closed
    }
  }

  sweep(now: number): void {
    this.sessionLimiter.sweep(now);
    this.ipLimiter.sweep(now);
    this.leadLimiter.sweep(now);
  }
}

/** $/day budget ÷ blended $/Mtok cost → token ceiling for the day. */
export function dailyTokenCeiling(usdCeiling: number, usdPerMtok: number): number {
  return Math.max(1, Math.round((usdCeiling / usdPerMtok) * 1_000_000));
}

/** Build the production config from ENV (read once at module load). */
export function guardConfigFromEnv(): GuardConfig {
  return {
    chatPerSession: ENV.landingAgentChatPerSession,
    chatPerIpHour: ENV.landingAgentChatPerIpHour,
    leadPerIpDay: ENV.landingAgentLeadPerIpDay,
    globalCeilingTokens: dailyTokenCeiling(ENV.landingAgentDailyUsdCeiling, ENV.landingAgentUsdPerMtok),
    identityCapTokens: ENV.landingAgentIdentityTokenCap,
  };
}

/** Process-wide singleton the P3 endpoint will use. Dark until then. */
export const landingAgentGuard = new LandingAgentGuard(guardConfigFromEnv());
