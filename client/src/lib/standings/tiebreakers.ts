/**
 * Tiebreaker resolution for tournament standings (D-FV5). Ported IO-free from the
 * aster-sports engine (src/lib/standings/tiebreakers.js) — same math, one source.
 *
 * A linear sequence captures Zero Gravity exactly: ['head_to_head','point_diff'].
 * 2-way tie -> head_to_head resolves; 3-way circular -> point_diff (capped) decides.
 */
export interface StandRow {
  id: string; name: string; gp: number; wins: number; losses: number; ties: number;
  pf: number; pa: number; diff: number; winPct: number;
}
export interface GameInput { aId: string; bId: string; aScore: number | null; bScore: number | null }

const EPS = 1e-9;
export const eq = (a: number, b: number): boolean => Math.abs(a - b) < EPS;

export function normalizeTeamName(name: unknown): string {
  return String(name ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

function cappedMargin(margin: number, cap: number | null): number {
  if (cap == null) return margin;
  return Math.max(-cap, Math.min(cap, margin));
}

function tiebreakerScore(rule: string, team: StandRow, group: StandRow[], games: GameInput[], cap: number | null): number {
  if (rule === "point_diff") return team.diff;
  if (rule === "wins") return team.wins;
  if (rule === "win_pct") return team.winPct;
  if (rule === "head_to_head" || rule === "point_diff_vs_tied") {
    const ids = new Set(group.map((g) => g.id));
    let w = 0, t = 0, gp = 0, pd = 0;
    for (const g of games) {
      if (g.aScore == null || g.bScore == null) continue;
      if (!ids.has(g.aId) || !ids.has(g.bId)) continue;
      let me: number, opp: number;
      if (g.aId === team.id) { me = g.aScore; opp = g.bScore; }
      else if (g.bId === team.id) { me = g.bScore; opp = g.aScore; }
      else continue;
      gp += 1;
      const m = me - opp;
      pd += cappedMargin(m, cap);
      if (m > 0) w += 1; else if (m === 0) t += 1;
    }
    if (rule === "point_diff_vs_tied") return pd;
    return gp ? (w + t * 0.5) / gp : 0;
  }
  return 0;
}

export function resolveTies(group: StandRow[], games: GameInput[], tiebreakers: string[], cap: number | null): StandRow[] {
  if (group.length <= 1) return [...group];
  if (!tiebreakers || tiebreakers.length === 0) {
    return [...group].sort((a, b) => normalizeTeamName(a.name).localeCompare(normalizeTeamName(b.name)));
  }
  const [rule, ...rest] = tiebreakers;
  const scored = group
    .map((t) => ({ t, score: tiebreakerScore(rule, t, group, games, cap) }))
    .sort((x, y) => y.score - x.score);

  const out: StandRow[] = [];
  let i = 0;
  while (i < scored.length) {
    let j = i;
    while (j + 1 < scored.length && eq(scored[j + 1].score, scored[i].score)) j += 1;
    const sub = scored.slice(i, j + 1).map((s) => s.t);
    if (sub.length === 1) out.push(sub[0]);
    else out.push(...resolveTies(sub, games, rest, cap));
    i = j + 1;
  }
  return out;
}
