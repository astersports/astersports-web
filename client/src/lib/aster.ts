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
