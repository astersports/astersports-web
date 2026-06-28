// Hub Home V2 — urgency model (§8 single ordering fn: the hero selector AND the accordion
// stack sort both consume this, so they can never disagree about which team is "most urgent").
// Pure: derived only from each tracked team's games. No fabrication — a team with no games is
// idle, not hidden. The "decision" tier (pool wrapped, clinch/must-win live) is layered on by an
// optional posture map the caller fills from the per-division predictor; without it, a team sorts
// by live > today > next-soonest > idle, which is gameable from the schedule alone.

import type { TeamGame } from "@/lib/aster";
import type { TrackedTeam } from "../trackingStore";
import { gamesForTeam } from "../teamGames";
import { pickNextGame } from "../nextGame";

export type UrgencyKind = "live" | "today" | "decision" | "idle";

export interface TeamUrgency {
  team: TrackedTeam;
  games: TeamGame[]; // this team's games (already matched)
  kind: UrgencyKind;
  liveGame: TeamGame | null; // a game in progress, if any
  nextGame: TeamGame | null; // soonest live-or-future non-final game
  tier: number; // 0 = most urgent
  nextMs: number; // soonest start (Infinity when none) — secondary sort
}

const ET = "America/New_York";
const DAY = new Intl.DateTimeFormat("en-CA", { timeZone: ET, year: "numeric", month: "2-digit", day: "2-digit" });
/** Local-tz (ET — AAU runs on ET) day key, so "today" doesn't roll over at UTC midnight (the
 *  original Home rollover bug — §5/§7). */
export const etDayKey = (d: Date | number): string => DAY.format(typeof d === "number" ? new Date(d) : d);

const TIER: Record<UrgencyKind, number> = { live: 0, today: 1, decision: 2, idle: 3 };

/**
 * Classify ONE tracked team's urgency from its games. `decisionKeys` (optional) upgrades an
 * otherwise-idle team whose pool has wrapped into a live decision (clinched/must-win/out),
 * supplied by the caller from the per-division predictor.
 */
export function classifyTeam(
  team: TrackedTeam,
  allGames: TeamGame[],
  now: Date = new Date(),
  decisionKeys?: Set<string>,
): TeamUrgency {
  const games = gamesForTeam(allGames, team);
  const liveGame = games.find((g) => g.status === "live") ?? null;
  const nextGame = pickNextGame(games, +now);
  const todayKey = etDayKey(now);
  const playsToday = games.some(
    (g) => g.status !== "final" && g.startAt != null && etDayKey(new Date(g.startAt)) === todayKey,
  );

  let kind: UrgencyKind;
  if (liveGame) kind = "live";
  else if (playsToday) kind = "today";
  else if (decisionKeys?.has(team.teamKey)) kind = "decision";
  else kind = "idle";

  const nextMs = nextGame?.startAt ? +new Date(nextGame.startAt) : Infinity;
  return { team, games, kind, liveGame, nextGame, tier: TIER[kind], nextMs };
}

/** Classify + urgency-sort every tracked team. Stable: tier first, then soonest next game, then
 *  name — so the order is deterministic across renders (no flicker). */
export function rankTeams(
  teams: TrackedTeam[],
  allGames: TeamGame[],
  now: Date = new Date(),
  decisionKeys?: Set<string>,
): TeamUrgency[] {
  return teams
    .map((t) => classifyTeam(t, allGames, now, decisionKeys))
    .sort((a, b) => a.tier - b.tier || a.nextMs - b.nextMs || a.team.name.localeCompare(b.team.name));
}

/** The single most-urgent team (hero source), or null when nothing is tracked. */
export function mostUrgent(ranked: TeamUrgency[]): TeamUrgency | null {
  return ranked[0] ?? null;
}
