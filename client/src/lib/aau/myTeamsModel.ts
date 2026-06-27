// My Teams · command center (render 03) — pure derivations from the tracked set + the
// tracked-team schedule. No fabrication: records come from FINAL games, "live"/"today"
// from real status/start times, and the live hero only exists when a tracked team has a
// game in progress. The "to advance %" is wired separately (predictor) in the component.

import type { TeamGame } from "@/lib/aster";
import type { TrackedTeam } from "./trackingStore";

export interface TeamSummary {
  teamKey: string;
  name: string;
  program: string;
  divisionId: string;
  record: { w: number; l: number };
  /** today's pill: a clock for an upcoming game, "W/L SS–SS" for a final, null otherwise */
  todayPill: { text: string; won: boolean } | null;
  todayCount: number;
}

export interface ProgramGroup {
  program: string;
  teams: TeamSummary[];
  todayCount: number;
}

export interface LiveHero {
  teamKey: string;
  division: string;
  pool: string | null;
  myName: string;
  oppName: string;
  myScore: number;
  oppScore: number;
  myWinning: boolean;
}

export interface MyTeamsModel {
  hero: LiveHero | null;
  glance: { liveNow: number; today: number };
  groups: ProgramGroup[];
}

const DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });
const CLOCK = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" });
const dayKey = (iso: string) => DAY.format(new Date(iso));
/** "11:00a" / "1:30p" — TM-style compact clock. */
function clockLabel(iso: string): string {
  const s = CLOCK.format(new Date(iso)).toLowerCase().replace(/\s/g, "");
  return s.replace(":00", "").replace("am", "a").replace("pm", "p");
}

function recordOf(games: TeamGame[]): { w: number; l: number } {
  let w = 0, l = 0;
  for (const g of games) {
    if (g.status !== "final" || g.myScore == null || g.oppScore == null) continue;
    if (g.myScore > g.oppScore) w++;
    else if (g.myScore < g.oppScore) l++;
  }
  return { w, l };
}

/** Today's pill for a team: a live/upcoming clock, or the latest final's result. */
function todayPill(today: TeamGame[]): { text: string; won: boolean } | null {
  if (!today.length) return null;
  const live = today.find((g) => g.status === "live");
  if (live) return { text: "LIVE", won: false };
  const upcoming = today.filter((g) => g.status === "scheduled" && g.startAt).sort((a, b) => +new Date(a.startAt!) - +new Date(b.startAt!));
  if (upcoming.length) return { text: clockLabel(upcoming[0].startAt!), won: false };
  const finals = today.filter((g) => g.status === "final" && g.myScore != null && g.oppScore != null);
  if (finals.length) {
    const g = finals[finals.length - 1];
    const won = (g.myScore as number) > (g.oppScore as number);
    return { text: `${won ? "W" : "L"} ${g.myScore}–${g.oppScore}`, won };
  }
  return null;
}

export function buildMyTeamsModel(tracked: TrackedTeam[], games: TeamGame[], now: number = Date.now()): MyTeamsModel {
  const today = dayKey(new Date(now).toISOString());
  const byTeam = new Map<string, TeamGame[]>();
  for (const g of games) {
    const arr = byTeam.get(g.trackedTeamId) ?? [];
    arr.push(g);
    byTeam.set(g.trackedTeamId, arr);
  }

  // live hero — first tracked team with a game in progress
  let hero: LiveHero | null = null;
  const liveGame = games.find((g) => g.status === "live" && g.myScore != null && g.oppScore != null);
  if (liveGame) {
    hero = {
      teamKey: liveGame.trackedTeamId,
      division: liveGame.division,
      pool: null,
      myName: liveGame.trackedTeamName,
      oppName: liveGame.opponent || "TBD",
      myScore: liveGame.myScore as number,
      oppScore: liveGame.oppScore as number,
      myWinning: (liveGame.myScore as number) >= (liveGame.oppScore as number),
    };
  }

  const summaries: TeamSummary[] = tracked.map((t) => {
    const g = byTeam.get(t.teamKey) ?? [];
    const todays = g.filter((x) => x.startAt && dayKey(x.startAt) === today);
    return {
      teamKey: t.teamKey,
      name: t.name,
      program: t.program,
      divisionId: t.divisionId,
      record: recordOf(g),
      todayPill: todayPill(todays),
      todayCount: todays.length,
    };
  });

  // group by program, programs with today-activity first, then by tracked count
  const m = new Map<string, TeamSummary[]>();
  for (const s of summaries) {
    const arr = m.get(s.program) ?? [];
    arr.push(s);
    m.set(s.program, arr);
  }
  const groups: ProgramGroup[] = Array.from(m.entries())
    .map(([program, teams]) => ({ program, teams, todayCount: teams.reduce((n, t) => n + t.todayCount, 0) }))
    .sort((a, b) => b.todayCount - a.todayCount || b.teams.length - a.teams.length);

  const liveNow = games.filter((g) => g.status === "live").length;
  const todayTotal = games.filter((g) => g.startAt && dayKey(g.startAt) === today).length;

  return { hero, glance: { liveNow, today: todayTotal }, groups };
}
