// AAU exact-status engine (architect A3). Pure, deterministic advancement read over the standings
// RPC output — the "most valuable half of the predictive model as pure certainty": CLINCHED / OUT
// are exact terminal states; IN_PLAY carries an exact position read, never a probability. The model
// % stays suppressed; this engine never emits one.
//
// CIRCUIT-AWARE (grounded: ARCHITECT_ZG_RULESET + ARCHITECT_BBALLSHOOTOUT_RULESET, 2026-06-27). The
// two circuits differ on almost every axis the engine branches on — cap, tiebreak cascade, forfeit
// math, exhibition — so the rules live in per-circuit config and are NEVER cross-applied.

export type TiebreakStep =
  | "head_to_head"
  | "capped_point_diff"
  | "points_allowed"
  | "points_scored"
  | "coin_flip";

// ZG: forfeit = hard OUT (cannot advance, overrides record). BBallshootout: forfeit = a recorded
// 25-0 loss already in the record (discretionary DQ not modeled) — same word, opposite math.
export type ForfeitMode = "hard_out" | "recorded_loss";

export interface CircuitConfig {
  name: string;
  pointDiffCap: number | null; // null = uncapped (e.g. League Play)
  cascade: TiebreakStep[]; // applied to teams tied on record
  forfeitMode: ForfeitMode;
  hasExhibition: boolean; // ZG marks a 4th game '*'; others have no exhibition concept
}

export const CIRCUITS: Record<string, CircuitConfig> = {
  "AAU Zero Gravity": {
    name: "AAU Zero Gravity",
    pointDiffCap: 20,
    cascade: ["head_to_head", "capped_point_diff", "points_allowed", "points_scored"],
    forfeitMode: "hard_out",
    hasExhibition: true,
  },
  BBallshootout: {
    name: "BBallshootout",
    pointDiffCap: 25, // explicit — happens to equal the default, but the cascade is the real differentiator
    cascade: ["head_to_head", "capped_point_diff", "points_scored", "coin_flip"],
    forfeitMode: "recorded_loss",
    hasExhibition: false,
  },
  "League Play": {
    name: "League Play",
    pointDiffCap: null, // uncapped (operator-confirmed)
    // posted League Play cascade not yet provided — conservative h2h→PD→points-scored; refine when posted.
    cascade: ["head_to_head", "capped_point_diff", "points_scored"],
    forfeitMode: "recorded_loss",
    hasExhibition: false,
  },
};

export function circuitConfig(circuit: string | null | undefined): CircuitConfig | null {
  return circuit ? CIRCUITS[circuit] ?? null : null;
}

// Neutral fallback for an UNKNOWN circuit — NOT a borrow of any named circuit's rules (that would be
// the cross-application the header forbids). Ranks by record then capped PD only; never claims a
// circuit-specific step (no points-allowed, no coin-flip) and never hard-outs a forfeit.
const NEUTRAL: CircuitConfig = {
  name: "default",
  pointDiffCap: 25,
  cascade: ["capped_point_diff"],
  forfeitMode: "recorded_loss",
  hasExhibition: false,
};

export interface TeamStanding {
  id: string;
  wins: number;
  losses: number;
  cappedPointDiff: number;
  pointsFor: number;
  pointsAgainst: number;
  isForfeit: boolean;
}
export interface PlayedGame { aId: string; bId: string; aScore: number; bScore: number }
export interface RemainingGame { aId: string; bId: string }

export type AdvState = "clinched" | "out" | "in_play";
export interface AdvStatus {
  state: AdvState;
  // for in_play: where the team sits relative to the cut line right now
  position?: "in_the_cut" | "on_the_bubble" | "needs_help";
  byTiebreaker?: boolean; // advancement can hinge on a tiebreak (architect §5: "director has final say")
  coinFlip?: boolean; // the cascade can terminate in a coin flip (BBallshootout) — stated, never predicted
  note?: string;
}

export interface AdvInput {
  teams: TeamStanding[];
  games: PlayedGame[]; // played (for head-to-head)
  remaining: RemainingGame[]; // scheduled
  advanceCount: number; // top-N advance
  circuit: string | null;
}

// Hard cap on scenario enumeration (2^n). Pools are small; above this we don't claim exact terminal
// states and leave teams in_play rather than assert a clinch/elim we didn't fully prove.
const MAX_ENUM = 18;

// Head-to-head result between two teams from played games: +1 a beat b more, -1 b beat a more, 0 even/none.
function headToHead(aId: string, bId: string, games: PlayedGame[]): number {
  let a = 0;
  let b = 0;
  for (const g of games) {
    if (g.aId === aId && g.bId === bId) g.aScore > g.bScore ? a++ : g.aScore < g.bScore ? b++ : 0;
    else if (g.aId === bId && g.bId === aId) g.aScore > g.bScore ? b++ : g.aScore < g.bScore ? a++ : 0;
  }
  return Math.sign(a - b);
}

// Order a group of teams tied on record via the circuit cascade. Returns the ordering plus whether a
// tiebreak was needed and whether it bottomed out in a coin flip. Pure read over the provided stats.
function resolveTie(
  group: TeamStanding[],
  cfg: CircuitConfig,
  games: PlayedGame[],
): { ordered: TeamStanding[]; usedTiebreak: boolean; coinFlip: boolean } {
  if (group.length <= 1) return { ordered: group, usedTiebreak: false, coinFlip: false };
  let usedTiebreak = false;
  let coinFlip = false;
  const ordered = [...group].sort((x, y) => {
    for (const step of cfg.cascade) {
      if (step === "head_to_head") {
        // head-to-head is a 2-team rule (ZG); for 3+ it's only decisive among the whole tied group
        // (BBallshootout confirm) — for a pairwise comparator we apply it only when exactly two remain
        // tied. We approximate by using pairwise h2h when the group is 2; for 3+ groups h2h is skipped
        // here and PD carries (matches ZG; BBallshootout falls through to PD when h2h isn't decisive).
        if (group.length === 2) {
          const h = headToHead(x.id, y.id, games);
          if (h !== 0) { usedTiebreak = true; return -h; }
        }
        continue;
      }
      if (step === "capped_point_diff") {
        if (x.cappedPointDiff !== y.cappedPointDiff) { usedTiebreak = true; return y.cappedPointDiff - x.cappedPointDiff; }
        continue;
      }
      if (step === "points_allowed") {
        if (x.pointsAgainst !== y.pointsAgainst) { usedTiebreak = true; return x.pointsAgainst - y.pointsAgainst; }
        continue;
      }
      if (step === "points_scored") {
        if (x.pointsFor !== y.pointsFor) { usedTiebreak = true; return y.pointsFor - x.pointsFor; }
        continue;
      }
      if (step === "coin_flip") { coinFlip = true; return 0; }
    }
    return 0;
  });
  return { ordered, usedTiebreak, coinFlip };
}

// Full ranking of all teams: by wins desc, then the cascade within each record-tier.
function rankTeams(teams: TeamStanding[], cfg: CircuitConfig, games: PlayedGame[]) {
  const tiers = new Map<number, TeamStanding[]>();
  for (const t of teams) {
    const arr = tiers.get(t.wins) ?? [];
    arr.push(t);
    tiers.set(t.wins, arr);
  }
  const order: TeamStanding[] = [];
  let usedTiebreak = false;
  let coinFlip = false;
  for (const wins of Array.from(tiers.keys()).sort((a, b) => b - a)) {
    const r = resolveTie(tiers.get(wins)!, cfg, games);
    usedTiebreak = usedTiebreak || r.usedTiebreak;
    coinFlip = coinFlip || r.coinFlip;
    order.push(...r.ordered);
  }
  return { order, usedTiebreak, coinFlip };
}

// Enumerate win/loss outcomes of the remaining games and, for each, decide who is above/below the cut
// by RECORD ALONE (wins). A clinch/elim we assert only when it holds by record in every scenario —
// matching the architect's §5: certain by record = absolute; tiebreak-dependent = labeled, not claimed.
export function computeAdvancement(input: AdvInput): Map<string, AdvStatus> {
  const { teams, games, remaining, advanceCount } = input;
  const cfg = circuitConfig(input.circuit);
  const result = new Map<string, AdvStatus>();
  if (teams.length === 0) return result;

  // Forfeit branching by circuit. ZG: hard OUT. Others: a recorded loss already in the record (no override).
  const forfeitOut = new Set<string>();
  if (cfg?.forfeitMode === "hard_out") {
    for (const t of teams) if (t.isForfeit) forfeitOut.add(t.id);
  }

  const N = advanceCount > 0 ? advanceCount : Math.ceil(teams.length / 2);
  const eligible = teams.filter((t) => !forfeitOut.has(t.id));
  const winsNow = new Map(teams.map((t) => [t.id, t.wins]));

  // Tally of how many scenarios put each team strictly-in / strictly-out by record, plus boundary count.
  const inAll = new Map<string, boolean>();
  const outAll = new Map<string, boolean>();
  const everBoundary = new Set<string>();
  for (const t of eligible) { inAll.set(t.id, true); outAll.set(t.id, true); }

  const n = remaining.length;
  const exact = n <= MAX_ENUM;
  const scenarios = exact ? 1 << n : 0;

  if (exact) {
    for (let mask = 0; mask < scenarios; mask++) {
      const w = new Map(winsNow);
      for (let i = 0; i < n; i++) {
        const g = remaining[i];
        const aWins = (mask >> i) & 1;
        const id = aWins ? g.aId : g.bId;
        if (w.has(id) && !forfeitOut.has(id)) w.set(id, (w.get(id) ?? 0) + 1);
      }
      // rank eligible teams by final wins (record only) to read the cut line for this scenario
      const sorted = [...eligible].sort((a, b) => (w.get(b.id) ?? 0) - (w.get(a.id) ?? 0));
      const cutWins = w.get(sorted[Math.min(N, sorted.length) - 1]?.id) ?? -Infinity; // Nth team's wins
      const firstOutWins = w.get(sorted[N]?.id) ?? -Infinity; // (N+1)th team's wins
      for (const t of eligible) {
        const tw = w.get(t.id) ?? 0;
        const strictlyIn = tw > firstOutWins; // more wins than the best non-qualifier → in by record
        const strictlyOut = tw < cutWins; // fewer wins than the worst qualifier → out by record
        if (!strictlyIn) inAll.set(t.id, false);
        if (!strictlyOut) outAll.set(t.id, false);
        if (!strictlyIn && !strictlyOut) everBoundary.add(t.id);
      }
    }
  }

  // Current-standing rank for the position read (in the cut / bubble / needs help).
  const effCfg = cfg ?? NEUTRAL;
  const ranked = rankTeams(eligible, effCfg, games);
  const curRank = new Map(ranked.order.map((t, i) => [t.id, i]));

  // PER-TEAM coin-flip: resolve only THIS team's own wins-tier group. A tie in an unrelated tier must
  // never leak the flag pool-wide (Copilot #166). Returns true only if the team's own tied group
  // bottoms out at a coin_flip step (BBallshootout); a singleton tier is never a coin flip.
  const tierCoinFlip = (t: TeamStanding): boolean => {
    const group = eligible.filter((e) => e.wins === t.wins);
    return group.length >= 2 && resolveTie(group, effCfg, games).coinFlip;
  };

  for (const t of teams) {
    if (forfeitOut.has(t.id)) {
      result.set(t.id, { state: "out", note: "forfeit — cannot advance from pool play" });
      continue;
    }
    if (exact && inAll.get(t.id)) {
      result.set(t.id, { state: "clinched" });
      continue;
    }
    if (exact && outAll.get(t.id)) {
      result.set(t.id, { state: "out" });
      continue;
    }
    // in_play — read position from current standing, flag tiebreak/coin-flip dependence
    const rank = curRank.get(t.id) ?? teams.length;
    const position = rank < N ? "in_the_cut" : everBoundary.has(t.id) ? "on_the_bubble" : "needs_help";
    const byTiebreaker = everBoundary.has(t.id); // per-team: this team can hinge on a tiebreak
    const coinFlip = byTiebreaker && tierCoinFlip(t); // and its own tied group bottoms out in a coin flip
    result.set(t.id, {
      state: "in_play",
      position,
      ...(byTiebreaker ? { byTiebreaker: true } : {}),
      ...(coinFlip ? { coinFlip: true } : {}),
      ...(coinFlip ? { note: "could come down to a coin flip" } : {}),
    });
  }
  return result;
}
