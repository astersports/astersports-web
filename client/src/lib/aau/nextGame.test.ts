import { describe, it, expect } from "vitest";
import { pickNextGame, countdownLabel } from "./nextGame";
import { leaveByLabel } from "./driveTime";
import type { TeamGame } from "@/lib/aster";

const NOW = Date.parse("2026-06-27T12:00:00-04:00");
const g = (over: Partial<TeamGame>): TeamGame => ({
  gameId: "x", gameCode: "P1", trackedTeamId: "t1", trackedTeamName: "Legacy 11U",
  isHome: true, opponent: "CT Hoops", myScore: null, oppScore: null,
  status: "scheduled", startAt: null, court: "Court 3", division: "Boys - 5th",
  tournamentId: "T", tournament: "Rumble", venue: null, ...over,
});

describe("pickNextGame", () => {
  it("returns the soonest upcoming non-final game", () => {
    const games = [
      g({ gameId: "past", startAt: "2026-06-27T09:00:00-04:00" }),
      g({ gameId: "final", startAt: "2026-06-27T13:00:00-04:00", status: "final" }),
      g({ gameId: "soon", startAt: "2026-06-27T14:00:00-04:00" }),
      g({ gameId: "later", startAt: "2026-06-27T18:00:00-04:00" }),
    ];
    expect(pickNextGame(games, NOW)?.gameId).toBe("soon");
  });

  it("returns null when nothing is upcoming", () => {
    expect(pickNextGame([g({ startAt: "2026-06-27T09:00:00-04:00" })], NOW)).toBeNull();
    expect(pickNextGame([], NOW)).toBeNull();
    expect(pickNextGame([g({ startAt: null })], NOW)).toBeNull();
  });
});

describe("countdownLabel", () => {
  it("formats h:mm inside a day, d h beyond, null once passed", () => {
    expect(countdownLabel(NOW + 72 * 60000, NOW)).toBe("1:12");
    expect(countdownLabel(NOW + 9 * 60000, NOW)).toBe("0:09");
    expect(countdownLabel(NOW + (2 * 1440 + 5 * 60) * 60000, NOW)).toBe("2d 5h");
    expect(countdownLabel(NOW - 60000, NOW)).toBeNull();
  });
});

describe("leaveByLabel", () => {
  it("subtracts drive + buffer (default 10) from the start time", () => {
    const start = Date.parse("2026-06-27T14:00:00-04:00");
    // 18 min drive + 10 min buffer = 28 min before start (tz-agnostic check)
    const expected = new Date(start - 28 * 60000).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    expect(leaveByLabel(start, 18)).toBe(expected);
    expect(leaveByLabel(start, 18)).not.toBe(
      new Date(start).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }),
    );
  });
});
