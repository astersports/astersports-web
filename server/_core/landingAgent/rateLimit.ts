/**
 * Sliding-window rate limiter for the landing "Aster Scout" agent
 * (docs/SPEC_LANDING_AGENT.txt §5, P2). In-memory, per-process.
 *
 * Caveat (documented, not a bug): the store is per-process, so on a multi-
 * instance Railway deploy each instance keeps its own window — effective limits
 * scale with the instance count. Pre-onboarding the app runs single-instance and
 * this is fine; the global spend ceiling (spendLedger) is the real backstop. Back
 * this with a shared store (Supabase table / Redis) before horizontal scaling.
 *
 * `now` is injected (ms epoch) so the window math is deterministic under test.
 */

export interface RateDecision {
  allowed: boolean;
  /** Remaining hits in the current window after this call (0 when denied). */
  remaining: number;
  /** ms until the oldest in-window hit expires (0 when allowed). */
  retryAfterMs: number;
}

export class SlidingWindowLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  /**
   * Record an attempt for `key` at `now` and decide if it's within the limit.
   * Allowed attempts are counted; denied attempts are NOT (so a blocked client
   * hammering the endpoint can't push its own reset further out).
   */
  check(key: string, now: number): RateDecision {
    const cutoff = now - this.windowMs;
    const recent = (this.hits.get(key) ?? []).filter((t) => t > cutoff);

    if (recent.length >= this.limit) {
      this.hits.set(key, recent); // keep the pruned window; do not count the denied hit
      const retryAfterMs = Math.max(0, recent[0] + this.windowMs - now);
      return { allowed: false, remaining: 0, retryAfterMs };
    }

    recent.push(now);
    this.hits.set(key, recent);
    return { allowed: true, remaining: this.limit - recent.length, retryAfterMs: 0 };
  }

  /** Drop keys whose entire window has expired — bounds memory over time. */
  sweep(now: number): void {
    const cutoff = now - this.windowMs;
    this.hits.forEach((arr, key) => {
      const recent = arr.filter((t) => t > cutoff);
      if (recent.length === 0) this.hits.delete(key);
      else this.hits.set(key, recent);
    });
  }

  /** Test hook. */
  reset(): void {
    this.hits.clear();
  }
}
