/**
 * Aster Sports platform — public read client for the astersports.io/aau parent hub.
 *
 * The AAU hub is a THIN PUBLIC CONSUMER of the Aster Sports platform Supabase (the
 * single backbone): it reads org-gated public data straight from the platform via the
 * publishable anon key — same pattern the Legacy Hoopers site uses. No server, no data
 * clone. The URL + anon key are PUBLISHABLE (designed to ship in the browser); the data
 * is gated server-side by `org_is_public_listed` + RLS, so anon can only read what the
 * platform has explicitly published. Hardcoded (not VITE_ env) on purpose: a public read
 * key has no secret to protect, and baking it in avoids the unset-env white-screen.
 */
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://vrwwpsbfbnveawqwbdmj.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_8semOyZSkr_QGr2hwmjDdQ_-U8KRtw4";

export const aster = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ─── Shapes returned by get_public_tournament_standings (jsonb bundle) ───
export interface StandingsTeam { id: string; name: string; isOurs: boolean }
export interface StandingsGame { aId: string; bId: string; aScore: number; bScore: number }
export interface RemainingGame { aId: string; bId: string }
export interface StandingsRules { pointDiffCap: number | null; tiebreakers: string[] }
export interface StandingsDivision { id: string; name: string; circuit: string | null; advance_count: number }
export interface PublicStandingsBundle {
  division: StandingsDivision;
  rules: StandingsRules;
  teams: StandingsTeam[];
  games: StandingsGame[];
  remaining: RemainingGame[];
}

/**
 * Public read of one tournament division's standings inputs (teams + final games +
 * remaining games + rules). Returns null when the division is not public / not found.
 * Destructures {data,error} and surfaces error before use (platform anti-pattern #36).
 */
export async function getTournamentStandings(divisionId: string): Promise<PublicStandingsBundle | null> {
  const { data, error } = await aster.rpc("get_public_tournament_standings", { p_division_id: divisionId });
  if (error) throw error;
  return (data as PublicStandingsBundle | null) ?? null;
}

// ─── Directory: public tournaments + their divisions (the hub's browse tree) ───
export interface DirDivision {
  id: string; name: string; grade_label: string | null; gender: "M" | "F" | "Coed" | null;
  advance_count: number; team_count: number;
}
export interface DirTournament {
  id: string; name: string; circuit: string | null; start_date: string; end_date: string;
  divisions: DirDivision[];
}

/** Every public-listed tournament with its divisions. [] when nothing is public yet. */
export async function getTournamentDirectory(): Promise<DirTournament[]> {
  const { data, error } = await aster.rpc("get_public_tournament_directory");
  if (error) throw error;
  return (data as DirTournament[]) ?? [];
}

// ─── A team's season across tournaments (powers the real-data kid view) ───
// The public-listed org that hosts the cross-program hub directory (the pilot
// tenant; the RPC is org-gated so this is safe to ship in the browser).
export const HUB_ORG_ID = "e3e95e21-3571-4e9a-985a-d5d01480d4a6";

export interface TeamSeasonRow {
  tournament: string; startDate: string; endDate: string;
  division: string; divisionId: string; circuit: string | null;
  teamKey: string; teamCount: number;
  wins: number; losses: number; diff: number; gamesPlayed: number;
}

/**
 * Public read of a team's per-tournament record across the season. `teamName` is an
 * ILIKE; `divisionLike` narrows by division (e.g. '%Girls%') for clubs that field
 * multiple teams under one name. Records are per-game-capped per the circuit's rule.
 */
export async function getTeamSeason(teamName: string, divisionLike: string | null = null): Promise<TeamSeasonRow[]> {
  const { data, error } = await aster.rpc("get_public_team_season", {
    p_org_id: HUB_ORG_ID, p_team_name: teamName, p_division_like: divisionLike,
  });
  if (error) throw error;
  return (data as TeamSeasonRow[]) ?? [];
}
