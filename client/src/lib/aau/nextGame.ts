// Killer #2 — "Next game" selection + countdown. Pure (no IO) so it unit-tests in
// isolation. Operates on the tracked-team schedule (get_public_aau_team_schedule via
// getTrackedTeamSchedule). No fabrication — a team with no upcoming game yields null and
// the card self-hides.

import type { TeamGame } from "@/lib/aster";

/** The soonest upcoming (non-final, real start time) game across the tracked schedule. */
export function pickNextGame(games: TeamGame[], now: number = Date.now()): TeamGame | null {
  let best: TeamGame | null = null;
  let bestMs = Infinity;
  for (const g of games) {
    if (!g.startAt || g.status === "final") continue;
    const ms = new Date(g.startAt).getTime();
    if (!Number.isFinite(ms) || ms < now) continue;
    if (ms < bestMs) {
      bestMs = ms;
      best = g;
    }
  }
  return best;
}

/**
 * Countdown to an absolute instant. "1:12" (h:mm) inside a day, "2d 5h" beyond a day,
 * "0:09" in the final hour. Returns null once the instant has passed (caller can flip to
 * a "playing now" / live state). Pure.
 */
export function countdownLabel(targetMs: number, now: number = Date.now()): string | null {
  const diff = targetMs - now;
  if (diff <= 0) return null;
  const totalMin = Math.floor(diff / 60000);
  const days = Math.floor(totalMin / 1440);
  const h = Math.floor((totalMin % 1440) / 60);
  const m = totalMin % 60;
  if (days >= 1) return `${days}d ${h}h`;
  return `${h}:${String(m).padStart(2, "0")}`;
}
