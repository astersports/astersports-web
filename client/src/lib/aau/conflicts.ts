// Conflict radar (killer #3) — pure overlap detection over tracked teams' games.
// "Two kids, two courts, overlapping" — we flag any two games from DIFFERENT tracked
// teams whose windows overlap on the same day, so a family knows to split up. Pure +
// testable; the UI (ConflictRadar) only renders what this returns. All day/time math is
// America/New_York (AAU runs on ET) so a late-evening UTC instant lands on the right day.

import type { TeamGame } from "@/lib/aster";
import type { TrackedTeam } from "./trackingStore";

// Assumed game length for overlap detection. AAU running-clock games run ~45–50 min wall;
// 50 keeps a "you can't be at both" window honest without over-flagging back-to-backs.
export const GAME_WINDOW_MIN = 50;

const ET = "America/New_York";
const dayKeyET = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: ET }); // YYYY-MM-DD
const dayLabelET = (d: Date) =>
  d.toLocaleDateString("en-US", { weekday: "long", timeZone: ET });
const timeET = (d: Date) =>
  d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: ET }).replace(" ", "");

/** "12:50–1:30PM" — drop the meridiem on the first time when both sides share it (render style). */
function fmtWindow(f: Date, t: Date): string {
  const a = timeET(f), b = timeET(t);
  return a.slice(-2) === b.slice(-2) ? `${a.slice(0, -2)}–${b}` : `${a}–${b}`;
}

/** Pull a "Court N" out of TM's combined venue string ("7 - Thayer Sports Center - Court 4"). */
export function parseCourt(venueName: string | null): string | null {
  if (!venueName) return null;
  const m = venueName.match(/court\s*([0-9A-Za-z]+)/i);
  return m ? `Ct ${m[1]}` : null;
}

/** Drop the leading "N - " ordinal + trailing "- Court X" so the venue reads cleanly. */
export function venueShortName(venueName: string | null): string | null {
  if (!venueName) return null;
  return venueName.replace(/^\s*\d+\s*-\s*/, "").replace(/\s*-\s*court\s*[0-9A-Za-z]+\s*$/i, "").trim() || venueName;
}

export interface ConflictGame {
  teamKey: string;
  label: string; // kid name if assigned, else team name
  teamName: string;
  start: Date;
  timeLabel: string; // "12:40pm"
  court: string | null; // "Ct 3"
  venue: string | null; // short venue name
  opponent: string | null;
  tournament: string;
}

export interface Overlap {
  a: ConflictGame;
  b: ConflictGame;
  from: Date;
  to: Date;
  windowLabel: string; // "12:50–1:10pm"
}

export interface DayConflict {
  dayKey: string;
  dayLabel: string; // "Saturday"
  games: ConflictGame[]; // every involved game that day, sorted by start
  overlaps: Overlap[];
}

/**
 * Find every day where two tracked teams' games overlap, forward-looking only
 * (from the start of `now`'s ET day). Games without a start time, final games, and
 * same-team pairs are ignored. Returns days sorted soonest-first.
 */
export function findConflicts(tracked: TrackedTeam[], games: TeamGame[], now: Date = new Date()): DayConflict[] {
  const labelByKey = new Map<string, { label: string; name: string }>();
  for (const t of tracked) labelByKey.set(t.teamKey, { label: t.kid?.trim() || t.name, name: t.name });

  const todayKey = dayKeyET(now);
  // candidate games: have a start, not finished, today or later
  const live: { g: TeamGame; start: Date }[] = [];
  for (const g of games) {
    if (!g.startAt || g.status === "final") continue;
    const start = new Date(g.startAt);
    if (dayKeyET(start) < todayKey) continue;
    live.push({ g, start });
  }

  // group by ET day
  const byDay = new Map<string, { g: TeamGame; start: Date }[]>();
  for (const x of live) {
    const k = dayKeyET(x.start);
    (byDay.get(k) ?? byDay.set(k, []).get(k)!).push(x);
  }

  const out: DayConflict[] = [];
  const windowMs = GAME_WINDOW_MIN * 60_000;

  for (const [dayKey, dayGames] of Array.from(byDay.entries())) {
    const overlaps: Overlap[] = [];
    const involved = new Map<string, ConflictGame>();
    const toCG = (x: { g: TeamGame; start: Date }): ConflictGame => {
      const meta = labelByKey.get(x.g.trackedTeamId);
      return {
        teamKey: x.g.trackedTeamId,
        label: meta?.label ?? x.g.trackedTeamName,
        teamName: meta?.name ?? x.g.trackedTeamName,
        start: x.start,
        timeLabel: timeET(x.start),
        court: parseCourt(x.g.venue?.name ?? null),
        venue: venueShortName(x.g.venue?.name ?? null),
        opponent: x.g.opponent,
        tournament: x.g.tournament,
      };
    };

    for (let i = 0; i < dayGames.length; i++) {
      for (let j = i + 1; j < dayGames.length; j++) {
        const A = dayGames[i], B = dayGames[j];
        if (A.g.trackedTeamId === B.g.trackedTeamId) continue; // same team can't double-book itself
        const aEnd = A.start.getTime() + windowMs;
        const bEnd = B.start.getTime() + windowMs;
        const from = Math.max(A.start.getTime(), B.start.getTime());
        const to = Math.min(aEnd, bEnd);
        if (from < to) {
          const cgA = toCG(A), cgB = toCG(B);
          involved.set(A.g.gameId, cgA);
          involved.set(B.g.gameId, cgB);
          const f = new Date(from), t = new Date(to);
          overlaps.push({ a: cgA, b: cgB, from: f, to: t, windowLabel: fmtWindow(f, t) });
        }
      }
    }

    if (overlaps.length) {
      const gamesSorted = Array.from(involved.values()).sort((a, b) => a.start.getTime() - b.start.getTime());
      out.push({ dayKey, dayLabel: dayLabelET(gamesSorted[0].start), games: gamesSorted, overlaps });
    }
  }

  return out.sort((a, b) => (a.dayKey < b.dayKey ? -1 : 1));
}
