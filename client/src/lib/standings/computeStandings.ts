/**
 * Rule-driven tournament standings engine (D-FV4). Ported IO-free from the aster-sports
 * engine (src/lib/standings/computeStandings.js) — same math, one source for the table
 * AND the predictor (platform AP #63). Reads the cap + tiebreakers from circuit_rules
 * (delivered by get_public_tournament_standings).
 */
import { eq, resolveTies, type GameInput, type StandRow } from "./tiebreakers";

export interface TeamInput { id: string; name?: string }
export interface Rules { pointDiffCap?: number | null; tiebreakers?: string[] }
export interface RankedRow extends StandRow { rank: number; advances: boolean | null }

const DEFAULT_TIEBREAKERS = ["head_to_head", "point_diff"];

function capMargin(margin: number, cap: number | null): number {
  if (cap == null) return margin;
  return Math.max(-cap, Math.min(cap, margin));
}

export interface ComputeArgs {
  teams?: TeamInput[];
  games?: GameInput[];
  rules?: Rules;
  advanceCount?: number | null;
}

export function computeStandings({ teams = [], games = [], rules = {}, advanceCount = null }: ComputeArgs = {}): RankedRow[] {
  const cap = typeof rules.pointDiffCap === "number" && Number.isFinite(rules.pointDiffCap) ? rules.pointDiffCap : null;
  const tiebreakers = rules.tiebreakers?.length ? rules.tiebreakers : DEFAULT_TIEBREAKERS;

  const rec = new Map<string, StandRow>();
  const ensure = (id: string, name?: string): StandRow => {
    let r = rec.get(id);
    if (!r) {
      r = { id, name: name ?? id, gp: 0, wins: 0, losses: 0, ties: 0, pf: 0, pa: 0, diff: 0, winPct: 0 };
      rec.set(id, r);
    }
    return r;
  };
  for (const t of teams) ensure(t.id, t.name);

  for (const g of games) {
    if (g.aScore == null || g.bScore == null) continue;
    const a = ensure(g.aId);
    const b = ensure(g.bId);
    a.gp += 1; b.gp += 1;
    a.pf += g.aScore; a.pa += g.bScore;
    b.pf += g.bScore; b.pa += g.aScore;
    const margin = g.aScore - g.bScore;
    const capped = capMargin(margin, cap);
    a.diff += capped; b.diff -= capped;
    if (margin > 0) { a.wins += 1; b.losses += 1; }
    else if (margin < 0) { b.wins += 1; a.losses += 1; }
    else { a.ties += 1; b.ties += 1; }
  }

  const rows: StandRow[] = Array.from(rec.values()).map((r) => ({ ...r, winPct: r.gp ? (r.wins + r.ties * 0.5) / r.gp : 0 }));

  rows.sort((x, y) => y.winPct - x.winPct);
  const ranked: StandRow[] = [];
  let i = 0;
  while (i < rows.length) {
    let j = i;
    while (j + 1 < rows.length && eq(rows[j + 1].winPct, rows[i].winPct)) j += 1;
    const group = rows.slice(i, j + 1);
    if (group.length === 1) ranked.push(group[0]);
    else ranked.push(...resolveTies(group, games, tiebreakers, cap));
    i = j + 1;
  }

  return ranked.map((r, idx) => ({ ...r, rank: idx + 1, advances: advanceCount == null ? null : idx < advanceCount }));
}
