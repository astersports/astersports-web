import { describe, it, expect } from "vitest";
import { buildMyTeamsModel } from "./myTeamsModel";
import type { TeamGame } from "@/lib/aster";
import type { TrackedTeam } from "./trackingStore";

const NOW = Date.parse("2026-06-27T12:00:00-04:00");
const team = (over: Partial<TrackedTeam>): TrackedTeam => ({
  teamKey: "t1", name: "10U Girls", program: "Legacy Hoopers", pool: null,
  tournamentId: "T", tournamentName: "Rumble", divisionId: "d1", divisionName: "Girls - 5th",
  kid: null, addedAt: 0, ...over,
});
const game = (over: Partial<TeamGame>): TeamGame => ({
  gameId: "g", gameCode: "P1", trackedTeamId: "t1", trackedTeamName: "10U Girls",
  isHome: true, opponent: "CT Hoops", myScore: null, oppScore: null,
  status: "scheduled", startAt: null, court: null, division: "Girls - 5th",
  tournamentId: "T", tournament: "Rumble", venue: null, ...over,
});

describe("buildMyTeamsModel", () => {
  it("computes record from finals, today pill, and glance counts", () => {
    const teams = [team({})];
    const games = [
      game({ gameId: "w", status: "final", myScore: 50, oppScore: 40, startAt: "2026-06-20T10:00:00-04:00" }),
      game({ gameId: "l", status: "final", myScore: 30, oppScore: 41, startAt: "2026-06-21T10:00:00-04:00" }),
      game({ gameId: "today", status: "scheduled", startAt: "2026-06-27T15:00:00-04:00" }),
    ];
    const m = buildMyTeamsModel(teams, games, NOW);
    expect(m.groups[0].teams[0].record).toEqual({ w: 1, l: 1 });
    expect(m.groups[0].teams[0].todayPill?.text).toBe("3p");
    expect(m.glance.today).toBe(1);
    expect(m.glance.liveNow).toBe(0);
    expect(m.hero).toBeNull();
  });

  it("surfaces a live game as the hero and counts it in liveNow", () => {
    const teams = [team({})];
    const games = [
      game({ gameId: "live", status: "live", myScore: 41, oppScore: 38, opponent: "Gravity Force", startAt: "2026-06-27T11:30:00-04:00" }),
    ];
    const m = buildMyTeamsModel(teams, games, NOW);
    expect(m.hero?.myName).toBe("10U Girls");
    expect(m.hero?.myScore).toBe(41);
    expect(m.hero?.oppScore).toBe(38);
    expect(m.hero?.myWinning).toBe(true);
    expect(m.glance.liveNow).toBe(1);
  });

  it("today pill shows the final result when the game is done", () => {
    const m = buildMyTeamsModel([team({})], [
      game({ status: "final", myScore: 52, oppScore: 47, startAt: "2026-06-27T09:00:00-04:00" }),
    ], NOW);
    expect(m.groups[0].teams[0].todayPill).toEqual({ text: "W 52–47", won: true });
  });
});
