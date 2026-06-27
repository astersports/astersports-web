import { describe, it, expect } from "vitest";
import { gamesForTeam } from "./teamGames";
import type { TeamGame } from "@/lib/aster";

// Locks the team-detail schedule split. The bug this guards: the schedule RPC returns
// trackedTeamId = the division-team UUID, but a tracked team's key is the resolved_key
// SLUG — comparing the two matched nothing, so every team-detail page read "no games"
// even though the RPC returned the games.
function game(over: Partial<TeamGame>): TeamGame {
  return {
    gameId: "g", gameCode: "P1", trackedTeamId: "uuid-default", trackedTeamName: "Dana Barros - Allen",
    isHome: true, opponent: "Foo", myScore: null, oppScore: null, status: "scheduled",
    startAt: null, court: null, division: "Boys - 4th", tournamentId: "t", tournament: "T",
    venue: null, ...over,
  };
}

describe("gamesForTeam", () => {
  it("matches a slug teamKey against the display-name (the uuid-vs-slug regression)", () => {
    const games = [
      game({ gameId: "a", trackedTeamId: "501c8259-uuid", trackedTeamName: "Dana Barros - Allen" }),
      game({ gameId: "b", trackedTeamId: "other-uuid", trackedTeamName: "Empire State Storm" }),
    ];
    const mine = gamesForTeam(games, { teamKey: "dana barros - allen" });
    expect(mine.map((g) => g.gameId)).toEqual(["a"]); // would be [] under the old uuid===slug filter
  });

  it("is case- and whitespace-insensitive on the name↔key match", () => {
    const games = [game({ trackedTeamName: "  DANA Barros - Allen " })];
    expect(gamesForTeam(games, { teamKey: "dana barros - allen" })).toHaveLength(1);
  });

  it("groups every division-team sharing the resolved_key (program-level schedule)", () => {
    const games = [
      game({ gameId: "a", trackedTeamId: "uuid-4th", division: "Boys - 4th" }),
      game({ gameId: "b", trackedTeamId: "uuid-6th", division: "Boys - 6th" }),
    ];
    expect(gamesForTeam(games, { teamKey: "dana barros - allen" })).toHaveLength(2);
  });

  it("still matches a legacy uuid teamKey via trackedTeamId", () => {
    const games = [game({ trackedTeamId: "uuid-123", trackedTeamName: "X" })];
    expect(gamesForTeam(games, { teamKey: "uuid-123" })).toHaveLength(1);
  });

  it("returns empty (not other teams' games) when the team has none", () => {
    const games = [game({ trackedTeamName: "Empire State Storm" })];
    expect(gamesForTeam(games, { teamKey: "dana barros - allen" })).toEqual([]);
  });
});
