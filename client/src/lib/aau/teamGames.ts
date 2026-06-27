import type { TeamGame } from "@/lib/aster";

// Split the combined My-Teams schedule down to ONE tracked team's games.
//
// `team.teamKey` is the STABLE resolved_key (a normalized-name slug) that
// get_public_aau_team_schedule keys on. The RPC echoes each game's team as
// `trackedTeamName` (the display_name) + `trackedTeamId` (the VOLATILE division-team
// uuid). So we match on the same basis the RPC selected rows — normalized
// display_name == resolved_key — with the raw `trackedTeamId` compare kept as a
// fallback for any legacy uuid-keyed track.
//
// Regression guard: the old `g.trackedTeamId === team.teamKey` compared a uuid to a
// slug and matched NOTHING once the schedule RPC was re-keyed onto resolved_key, so
// every team-detail page read "no games scheduled" even when the RPC returned games.
// See teamGames.test.ts.
export function gamesForTeam(games: TeamGame[], team: { teamKey: string }): TeamGame[] {
  const key = team.teamKey.trim().toLowerCase();
  return games.filter(
    (g) => g.trackedTeamName.trim().toLowerCase() === key || g.trackedTeamId === team.teamKey,
  );
}
