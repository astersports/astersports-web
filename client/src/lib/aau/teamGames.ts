import type { TeamGame } from "@/lib/aster";

// Split the combined My-Teams schedule down to ONE tracked team's games.
//
// `team.teamKey` is now the QUALIFIED KEY (qkey = resolved_key:gender:grade, ruling C)
// that get_public_aau_team_schedule keys on — it echoes each game's `qkey`, so the
// exact `g.qkey === team.teamKey` compare is the canonical match (it groups one team's
// season across tournaments while NOT merging different same-named teams).
//
// Two legacy arms stay for the transition (the RPC keeps its matching legacy arms too):
//   - name == bare resolved_key: a pre-qkey track stored the bare slug; resolved_key is
//     a normalized display_name, so `trackedTeamName == teamKey` still catches it.
//   - trackedTeamId == teamKey: a legacy uuid-keyed track.
//
// Regression guard: without the qkey arm, an account track whose key was backfilled to
// the qkey ("high rise - brie:F:6th") matches NEITHER the display-name NOR the uuid, so
// every team-detail page would read "no games scheduled" even though the RPC returned
// games. See teamGames.test.ts.
export function gamesForTeam(games: TeamGame[], team: { teamKey: string }): TeamGame[] {
  const raw = team.teamKey.trim();
  const key = raw.toLowerCase();
  return games.filter(
    (g) =>
      g.qkey === raw ||
      g.trackedTeamName.trim().toLowerCase() === key ||
      g.trackedTeamId === raw,
  );
}
