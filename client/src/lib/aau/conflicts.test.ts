import { describe, it, expect } from "vitest";
import { findConflicts, parseCourt, venueShortName, GAME_WINDOW_MIN } from "./conflicts";
import type { TeamGame } from "@/lib/aster";
import type { TrackedTeam } from "./trackingStore";

function team(teamKey: string, name: string, kid: string | null): TrackedTeam {
  return { teamKey, name, program: name, pool: null, tournamentId: "t", tournamentName: "T", divisionId: "d", divisionName: "D", kid, addedAt: 0 };
}
function game(teamKey: string, startAt: string | null, venueName: string | null, opts: Partial<TeamGame> = {}): TeamGame {
  return {
    gameId: `${teamKey}-${startAt}`, gameCode: "P1", trackedTeamId: teamKey, trackedTeamName: teamKey,
    isHome: true, opponent: "Opp", myScore: null, oppScore: null, status: "scheduled",
    startAt, court: null, division: "D", tournamentId: "t", tournament: "T",
    venue: venueName ? { name: venueName, address: null, city: null, state: null, lat: null, lng: null } : null,
    ...opts,
  };
}

const NOW = new Date("2026-06-14T08:00:00-04:00"); // Sat morning ET

describe("parseCourt / venueShortName", () => {
  it("pulls the court and a clean venue name from the TM combined string", () => {
    expect(parseCourt("7 - Thayer Sports Center - Court 4")).toBe("Ct 4");
    expect(parseCourt("County Center")).toBeNull();
    expect(venueShortName("7 - Thayer Sports Center - Court 4")).toBe("Thayer Sports Center");
    expect(venueShortName(null)).toBeNull();
  });
});

describe("findConflicts", () => {
  it("flags two different teams overlapping on the same day, with the overlap window", () => {
    const tracked = [team("charlie", "Legacy 11U", "Charlie"), team("rowan", "Legacy 9U", "Rowan")];
    const games = [
      game("charlie", "2026-06-14T16:40:00Z", "1 - County Center - Court 3"), // 12:40pm ET
      game("rowan", "2026-06-14T16:50:00Z", "1 - County Center - Court 1"),   // 12:50pm ET
    ];
    const res = findConflicts(tracked, games, NOW);
    expect(res).toHaveLength(1);
    expect(res[0].dayLabel).toBe("Sunday"); // 2026-06-14 is a Sunday in ET
    expect(res[0].overlaps).toHaveLength(1);
    // labels come from the kid assignment
    const labels = res[0].games.map((g) => g.label).sort();
    expect(labels).toEqual(["Charlie", "Rowan"]);
    // overlap = [later start, earlier start + window] = 12:50 .. 1:30 (12:40+50)
    expect(res[0].overlaps[0].windowLabel).toBe("12:50–1:30PM");
  });

  it("does NOT flag the same team's back-to-back games as a conflict", () => {
    const tracked = [team("charlie", "Legacy 11U", "Charlie")];
    const games = [
      game("charlie", "2026-06-14T16:40:00Z", "Court 3"),
      game("charlie", "2026-06-14T16:50:00Z", "Court 3"),
    ];
    expect(findConflicts(tracked, games, NOW)).toHaveLength(0);
  });

  it("ignores final games and past days", () => {
    const tracked = [team("a", "A", null), team("b", "B", null)];
    const games = [
      game("a", "2026-06-13T16:40:00Z", "Court 1"), // yesterday
      game("b", "2026-06-13T16:45:00Z", "Court 2"),
      game("a", "2026-06-14T16:40:00Z", "Court 1", { status: "final" }), // final today
      game("b", "2026-06-14T16:45:00Z", "Court 2"),
    ];
    expect(findConflicts(tracked, games, NOW)).toHaveLength(0);
  });

  it("does not flag teams whose games are more than a game-window apart", () => {
    const tracked = [team("a", "A", null), team("b", "B", null)];
    const games = [
      game("a", "2026-06-14T16:00:00Z", "Court 1"),
      game("b", `2026-06-14T${16}:${GAME_WINDOW_MIN + 5}:00Z`, "Court 2"), // 55 min later > 50 window
    ];
    expect(findConflicts(tracked, games, NOW)).toHaveLength(0);
  });
});
