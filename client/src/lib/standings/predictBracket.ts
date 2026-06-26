/**
 * D-FV5 bracket-qualification predictor. Ported IO-free from the aster-sports engine
 * (src/lib/standings/predictBracket.js). DETERMINISTIC: enumerate every win/loss combo
 * of the division's remaining games, run computeStandings per combo (AP #63), and count
 * the fraction where the focus team finishes top-`advanceCount`. That fraction IS the
 * exact odds; clinch/elim scenarios fall out of the same enumeration. Only the narration
 * is AI (done in the UI). OQ5 guard: advanceCount=null -> { available:false } (odds withheld).
 *
 * KNOWN LIMITATION (flagged): simulated games use a nominal 1-0 margin, so margin-dependent
 * tiebreaks are resolved at win/loss granularity for now (completed games keep real margins).
 */
import { computeStandings, type Rules, type TeamInput } from "./computeStandings";
import type { GameInput } from "./tiebreakers";

const MAX_ENUM_GAMES = 16;

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
}

export interface PredictArgs {
  teams?: TeamInput[];
  games?: GameInput[];
  remaining?: RemainingMatch[];
  rules?: Rules;
  advanceCount?: number | null;
  focusId?: string;
}

function focusAdvances(standings: ReturnType<typeof computeStandings>, focusId: string): boolean {
  const row = standings.find((r) => r.id === focusId);
  return !!row?.advances;
}

export function predictBracket({ teams = [], games = [], remaining = [], rules = {}, advanceCount = null, focusId }: PredictArgs = {}): Prediction {
  if (advanceCount == null) return { available: false, reason: "advance_count_unconfirmed" };
  if (!focusId) return { available: false, reason: "no_focus" };

  if (remaining.length === 0) {
    const adv = focusAdvances(computeStandings({ teams, games, rules, advanceCount }), focusId);
    return { available: true, decided: true, oddsPct: adv ? 100 : 0, status: adv ? "in" : "out", outcomes: 1, advancing: adv ? 1 : 0, scenarios: [] };
  }
  if (remaining.length > MAX_ENUM_GAMES) return { available: false, reason: "too_many_outcomes", remaining: remaining.length };

  const k = remaining.length;
  const total = 1 << k;
  const focusGameIdx = remaining.findIndex((g) => g.aId === focusId || g.bId === focusId);

  let advancing = 0;
  let winFocusTotal = 0, winFocusAdv = 0, loseFocusTotal = 0, loseFocusAdv = 0;

  for (let mask = 0; mask < total; mask += 1) {
    const sim: GameInput[] = remaining.map((g, j) => {
      const aWins = ((mask >> j) & 1) === 0;
      return { aId: g.aId, bId: g.bId, aScore: aWins ? 1 : 0, bScore: aWins ? 0 : 1 };
    });
    const adv = focusAdvances(computeStandings({ teams, games: games.concat(sim), rules, advanceCount }), focusId);
    if (adv) advancing += 1;
    if (focusGameIdx >= 0) {
      const g = remaining[focusGameIdx];
      const aWins = ((mask >> focusGameIdx) & 1) === 0;
      const focusWon = (g.aId === focusId && aWins) || (g.bId === focusId && !aWins);
      if (focusWon) { winFocusTotal += 1; if (adv) winFocusAdv += 1; }
      else { loseFocusTotal += 1; if (adv) loseFocusAdv += 1; }
    }
  }

  const oddsPct = Math.round((advancing / total) * 100);
  let status: Prediction["status"] = "live";
  if (advancing === total) status = "clinched";
  else if (advancing === 0) status = "eliminated";

  const scenarios: Scenario[] = [];
  if (focusGameIdx >= 0 && status === "live") {
    if (winFocusTotal > 0 && winFocusAdv === winFocusTotal) scenarios.push({ kind: "in", text: "Win your next game and you clinch." });
    if (loseFocusTotal > 0 && loseFocusAdv === 0) scenarios.push({ kind: "out", text: "Lose your next game and you are out." });
    if (loseFocusTotal > 0 && loseFocusAdv > 0 && loseFocusAdv < loseFocusTotal) scenarios.push({ kind: "maybe", text: "A loss still leaves you in, depending on the other results." });
  }

  return { available: true, decided: false, oddsPct, status, outcomes: total, advancing, scenarios };
}
