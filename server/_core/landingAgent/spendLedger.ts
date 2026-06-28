/**
 * Daily token-spend ledger for the landing agent (docs/SPEC_LANDING_AGENT.txt §5,
 * condition C3). Enforces TWO independent limits per UTC day:
 *   - a per-identity (per-IP) cap, so no single actor can exhaust the pool, and
 *   - a global ceiling, the backstop on total daily spend.
 *
 * This is deliberately SEPARATE from the rate limiter: the ceiling must hold even
 * if the limiter has a bug. The guard checks this ledger independently, so a
 * limiter that wrongly allows a turn still can't spend past the ceiling.
 *
 * In-memory, per-process (same caveat as rateLimit.ts — on multi-instance the
 * effective ceiling scales with instance count; single-instance pre-onboarding).
 * `now` is injected for deterministic day-rollover tests.
 */

export type SpendDenyReason = "identity_cap" | "global_ceiling";

export interface SpendDecision {
  allowed: boolean;
  reason?: SpendDenyReason;
}

/** UTC day key (YYYY-MM-DD) from an epoch-ms timestamp. */
function utcDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

export class DailySpendLedger {
  private day = "";
  private globalTokens = 0;
  private readonly identityTokens = new Map<string, number>();

  constructor(
    private readonly globalCeilingTokens: number,
    private readonly identityCapTokens: number,
  ) {}

  private rollover(now: number): void {
    const day = utcDay(now);
    if (day !== this.day) {
      this.day = day;
      this.globalTokens = 0;
      this.identityTokens.clear();
    }
  }

  /**
   * Atomic check-and-reserve. Allows only if BOTH the per-identity cap and the
   * global ceiling have room for `estTokens`. The identity cap is checked FIRST,
   * so an actor that has exhausted its own slice is told `identity_cap` and never
   * contributes to tripping the global ceiling for everyone else (condition C3).
   * Records the reservation on allow; records nothing on deny.
   */
  tryConsume(identity: string, estTokens: number, now: number): SpendDecision {
    this.rollover(now);
    const idUsed = this.identityTokens.get(identity) ?? 0;
    if (idUsed + estTokens > this.identityCapTokens) {
      return { allowed: false, reason: "identity_cap" };
    }
    if (this.globalTokens + estTokens > this.globalCeilingTokens) {
      return { allowed: false, reason: "global_ceiling" };
    }
    this.identityTokens.set(identity, idUsed + estTokens);
    this.globalTokens += estTokens;
    return { allowed: true };
  }

  /**
   * Reconcile actual usage against the reserved estimate once a turn completes.
   * `deltaTokens` is (actual − estimate); may be negative. Never drives a counter
   * below zero.
   */
  settle(identity: string, deltaTokens: number, now: number): void {
    this.rollover(now);
    this.globalTokens = Math.max(0, this.globalTokens + deltaTokens);
    const idUsed = this.identityTokens.get(identity) ?? 0;
    this.identityTokens.set(identity, Math.max(0, idUsed + deltaTokens));
  }

  snapshot(now: number): { day: string; globalTokens: number; globalCeilingTokens: number } {
    this.rollover(now);
    return { day: this.day, globalTokens: this.globalTokens, globalCeilingTokens: this.globalCeilingTokens };
  }

  /** Test hook. */
  reset(): void {
    this.day = "";
    this.globalTokens = 0;
    this.identityTokens.clear();
  }
}
