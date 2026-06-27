/**
 * D-FV5 bracket-qualification predictor. Ported IO-free from the aster-sports engine
 * (src/lib/standings/predictBracket.js). DETERMINISTIC: enumerate every win/loss combo
 * of the division's remaining games, run computeStandings per combo (AP #63), and sum the
 * PROBABILITY-WEIGHTED fraction where the focus team finishes top-`advanceCount`. Each
 * remaining game's outcome is weighted by a strength model (`eff`, effective team ratings
 * from cross-tournament results + a grade prior) instead of a 50/50 coin-flip, so a weaker
 * team can't out-project a stronger one. With no strength signal it degrades exactly to the
 * old uniform count. Clinch/elim fall out of the same enumeration. OQ5 guard:
 * advanceCount=null -> { available:false }.
 *
 * `basis` tells the UI how much to trust the number: "results" (the bracket has completed
 * games), "ratings" (no games yet but strength/grade differentiates the field — a
 * projection), or "even" (nothing differentiates the field — caller should gate to "—").
 *
 * KNOWN LIMITATION (flagged): simulated games use a nominal 1-0 margin, so margin-dependent
 * tiebreaks are resolved at win/loss granularity for now (completed games keep real margins).
 */
import { computeStandings, type Rules, type TeamInput } from "./computeStandings";
import type { GameInput } from "./tiebreakers";

const MAX_ENUM_GAMES = 16;
/** Logistic slope per rating point. eff ratings are point-margins, so a 10-point edge ≈ 73%. */
const RATING_SCALE = 0.1;

export interface RemainingMatch { aId: string; bId: string }
export interface Scenario { kind: "in" | "out" | "maybe"; text: string }
export interface Prediction {
  available: boolean;
  reason?: string;
  decided?: boolean;
  oddsPct?: number;
  status?: "in" | "out" | "live" | "clinched" | "eliminated";
  outcomes?: number;
  advancing?: number;
  remaining?: number;
  scenarios?: Scenario[];
  basis?: "results" | "ratings" | "even";
}

export interface PredictArgs {
  teams?: TeamInput[];
  games?: GameInput[];
  remaining?: RemainingMatch[];
  rules?: Rules;
  advanceCount?: number | null;
  focusId?: string;
  /** Effective strength rating per team id (cross-tournament rating − grade prior). Missing
   *  ids are treated as neutral (0). Omit entirely for a pure uniform prediction. */
  eff?: Record<string, number>;
}

function focusAdvances(standings: ReturnType<typeof computeStandings>, focusId: string): boolean {
  const row = standings.find((r) => r.id === focusId);
  return !!row?.advances;
}

/** P(a beats b) from effective ratings; 0.5 when neither side has a signal. */
function winProb(eff: Record<string, number> | undefined, aId: string, bId: string): number {
  const ra = eff?.[aId] ?? 0;
  const rb = eff?.[bId] ?? 0;
  return 1 / (1 + Math.exp(-RATING_SCALE * (ra - rb)));
}

/** Is there any strength/grade signal differentiating these teams? (drives the gate) */
function hasSignal(teams: TeamInput[], eff: Record<string, number> | undefined): boolean {
  if (!eff) return false;
  const vals = new Set(teams.map((t) => eff[t.id] ?? 0));
  return vals.size > 1;
}

export function predictBracket({ teams = [], games = [], remaining = [], rules = {}, advanceCount = null, focusId, eff }: PredictArgs = {}): Prediction {
  if (advanceCount == null) return { available: false, reason: "advance_count_unconfirmed" };
  if (!focusId) return { available: false, reason: "no_focus" };

  const played = games.length > 0;
  const signal = hasSignal(teams, eff);

  if (remaining.length === 0) {
    const adv = focusAdvances(computeStandings({ teams, games, rules, advanceCount }), focusId);
    return { available: true, decided: true, oddsPct: adv ? 100 : 0, status: adv ? "in" : "out", outcomes: 1, advancing: adv ? 1 : 0, scenarios: [], basis: played ? "results" : "even" };
  }
  if (remaining.length > MAX_ENUM_GAMES) return { available: false, reason: "too_many_outcomes", remaining: remaining.length };

  const basis: Prediction["basis"] = played ? "results" : signal ? "ratings" : "even";

  const k = remaining.length;
  const total = 1 << k;
  const focusGameIdx = remaining.findIndex((g) => g.aId === focusId || g.bId === focusId);

  let advancing = 0;          // count of advancing outcomes (for "X of Y" display + clinch/elim)
  let advancingProb = 0;      // probability-weighted advancement (the odds)
  let winFocusTotal = 0, winFocusAdv = 0, loseFocusTotal = 0, loseFocusAdv = 0;

  for (let mask = 0; mask < total; mask += 1) {
    let prob = 1;
    const sim: GameInput[] = remaining.map((g, j) => {
      const aWins = ((mask >> j) & 1) === 0;
      prob *= aWins ? winProb(eff, g.aId, g.bId) : 1 - winProb(eff, g.aId, g.bId);
      return { aId: g.aId, bId: g.bId, aScore: aWins ? 1 : 0, bScore: aWins ? 0 : 1 };
    });
    const adv = focusAdvances(computeStandings({ teams, games: games.concat(sim), rules, advanceCount }), focusId);
    if (adv) { advancing += 1; advancingProb += prob; }
    if (focusGameIdx >= 0) {
      const g = remaining[focusGameIdx];
      const aWins = ((mask >> focusGameIdx) & 1) === 0;
      const focusWon = (g.aId === focusId && aWins) || (g.bId === focusId && !aWins);
      if (focusWon) { winFocusTotal += 1; if (adv) winFocusAdv += 1; }
      else { loseFocusTotal += 1; if (adv) loseFocusAdv += 1; }
    }
  }

  const oddsPct = Math.round(advancingProb * 100);
  let status: Prediction["status"] = "live";
  if (advancing === total) status = "clinched";
  else if (advancing === 0) status = "eliminated";

  const scenarios: Scenario[] = [];
  if (focusGameIdx >= 0 && status === "live") {
    if (winFocusTotal > 0 && winFocusAdv === winFocusTotal) scenarios.push({ kind: "in", text: "Win your next game and you clinch." });
    if (loseFocusTotal > 0 && loseFocusAdv === 0) scenarios.push({ kind: "out", text: "Lose your next game and you are out." });
    if (loseFocusTotal > 0 && loseFocusAdv > 0 && loseFocusAdv < loseFocusTotal) scenarios.push({ kind: "maybe", text: "A loss still leaves you in, depending on the other results." });
  }

  return { available: true, decided: false, oddsPct, status, outcomes: total, advancing, scenarios, basis };
}
