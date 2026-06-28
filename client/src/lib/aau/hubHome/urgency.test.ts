import { describe, it, expect } from "vitest";
import { rankTeams, classifyTeam, mostUrgent } from "./urgency";
import type { TeamGame } from "@/lib/aster";
import type { TrackedTeam } from "../trackingStore";

function team(teamKey: string, name: string): TrackedTeam {
  return { teamKey, name, program: name, pool: null, tournamentId: "t", tournamentName: "T", divisionId: "d", divisionName: "D", kid: null, addedAt: 0 };
}
function game(teamKey: string, startAt: string | null, status: TeamGame["status"], opts: Partial<TeamGame> = {}): TeamGame {
  return {
    gameId: `${teamKey}-${startAt}-${status}`, gameCode: "P1", trackedTeamId: teamKey, trackedTeamName: teamKey,
    qkey: teamKey, isHome: true, opponent: "Opp", myScore: null, oppScore: null, status,
    startAt, court: null, division: "D", tournamentId: "t", tournament: "T", venue: null, ...opts,
  };
}

const NOW = new Date("2026-06-28T16:00:00-04:00"); // Sun noon ET

describe("urgency classify + rank", () => {
  it("orders live > today > idle, then by soonest next game", () => {
    const teams = [team("idle", "Idle"), team("today2pm", "Today2"), team("live", "Live"), team("today11am", "Today1")];
    const games = [
      game("idle", "2026-07-05T18:00:00Z", "scheduled"), // next week
      game("today2pm", "2026-06-28T18:00:00Z", "scheduled"), // 2pm ET today
      game("live", "2026-06-28T15:30:00Z", "live"),
      game("today11am", "2026-06-28T15:00:00Z", "scheduled"), // 11am ET today (soon)
    ];
    const ranked = rankTeams(teams, games, NOW);
    expect(ranked.map((r) => r.team.teamKey)).toEqual(["live", "today11am", "today2pm", "idle"]);
    expect(ranked[0].kind).toBe("live");
    expect(ranked[3].kind).toBe("idle");
    expect(mostUrgent(ranked)?.team.teamKey).toBe("live");
  });

  it("a game today that already went final does NOT make the team 'today' (final-only ingest)", () => {
    const t = team("a", "A");
    const games = [game("a", "2026-06-28T14:00:00Z", "final", { myScore: 40, oppScore: 30 })];
    expect(classifyTeam(t, games, NOW).kind).toBe("idle");
  });

  it("decisionKeys upgrades an idle team to the 'decision' tier (above idle)", () => {
    const teams = [team("idle", "Idle"), team("clinch", "Clinch")];
    const games = [
      game("idle", "2026-07-10T18:00:00Z", "scheduled"),
      game("clinch", "2026-06-20T18:00:00Z", "final", { myScore: 50, oppScore: 20 }), // pool done
    ];
    const ranked = rankTeams(teams, games, NOW, new Set(["clinch"]));
    expect(ranked[0].team.teamKey).toBe("clinch");
    expect(ranked[0].kind).toBe("decision");
  });

  it("no teams → empty rank, null hero", () => {
    const ranked = rankTeams([], [], NOW);
    expect(ranked).toHaveLength(0);
    expect(mostUrgent(ranked)).toBeNull();
  });
});
