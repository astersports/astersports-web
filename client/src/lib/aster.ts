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

// ─── Global team search (Find): one query → the team across every tournament ───
export interface TeamHit {
  teamKey: string; // tournament_division_teams id (stable per team within a division)
  name: string;
  tournamentId: string; tournamentName: string;
  startDate: string; endDate: string;
  divisionId: string; divisionName: string;
  gradeLabel: string | null; gender: string | null;
}

/** Search teams by name across every public tournament (deduped). [] for a blank query. */
export async function searchPublicTeams(query: string): Promise<TeamHit[]> {
  if (!query.trim()) return [];
  const { data, error } = await aster.rpc("search_public_teams", { p_query: query });
  if (error) throw error;
  return (data as TeamHit[]) ?? [];
}

// ─── Screen 02 "Track one or many": a tournament's teams by division ───
export interface TrackTeam {
  id: string; name: string; pool: string | null;
  wins: number; losses: number; diff: number; isOurs: boolean;
}
export interface TrackDivision {
  id: string; name: string; grade_label: string | null; gender: string | null;
  advance_count: number; teams: TrackTeam[];
}
export interface TournamentTeams {
  tournament: { id: string; name: string; circuit: string | null; start_date: string; end_date: string };
  divisions: TrackDivision[];
}

/** Every division of a tournament with each team's pool + W–L. null if not public/found. */
export async function getTournamentTeams(tournamentId: string): Promise<TournamentTeams | null> {
  const { data, error } = await aster.rpc("get_public_tournament_teams", { p_tournament_id: tournamentId });
  if (error) throw error;
  return (data as TournamentTeams | null) ?? null;
}

// ─── Tracked teams' schedule (My Teams killers: next-game+travel, conflict radar) ───
export interface TeamGameVenue {
  name: string | null; address: string | null; city: string | null; state: string | null;
  lat: number | null; lng: number | null;
}
export interface TeamGame {
  gameId: string; gameCode: string;
  trackedTeamId: string; trackedTeamName: string;
  isHome: boolean; opponent: string | null;
  myScore: number | null; oppScore: number | null;
  status: "scheduled" | "live" | "final";
  startAt: string | null; court: string | null;
  division: string; tournamentId: string; tournament: string;
  venue: TeamGameVenue | null;
}

/** Every game (past + upcoming) for the given tracked team ids (tournament_division_team
 *  ids), with opponent + time + venue. [] for an empty id list. Sorted by start time. */
export async function getTrackedTeamSchedule(teamIds: string[]): Promise<TeamGame[]> {
  if (!teamIds.length) return [];
  const { data, error } = await aster.rpc("get_public_aau_team_schedule", { p_team_ids: teamIds });
  if (error) throw error;
  return (data as TeamGame[]) ?? [];
}

// ─── Self-serve paste-to-track (Screen 01) ───
// A parent pastes a TourneyMachine link; the public aau-submit-tournament edge function
// resolves it, scrapes server-side (the ingest_secret never leaves the server), and the
// new tournament lands in the directory. The UI polls getIngestStatus until it's ready.
const FUNCTIONS_BASE = `${SUPABASE_URL}/functions/v1`;

export interface SubmitResult {
  ok: boolean;
  status?: "ingesting" | "ready"; // ingesting → poll submissionId; ready → already loaded
  submissionId?: string;
  tournamentId?: string;
  error?: string; // kindness microcopy from the server on a miss
}

/** Hand a pasted TourneyMachine URL to the public submit function. Never throws on a
 *  4xx/5xx — the friendly `error` string rides in the body so the UI can show it. */
export async function submitTournament(url: string): Promise<SubmitResult> {
  try {
    const res = await fetch(`${FUNCTIONS_BASE}/aau-submit-tournament`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY },
      body: JSON.stringify({ url }),
    });
    const body = (await res.json().catch(() => ({}))) as SubmitResult;
    return body?.ok ? body : { ok: false, error: body?.error || "Couldn't reach the importer. Try again in a moment." };
  } catch {
    return { ok: false, error: "Couldn't reach the importer. Check your connection and try again." };
  }
}

export interface IngestStatus {
  status: "pending" | "ok" | "error" | "duplicate" | "missing" | null;
  tournamentId: string | null;
  tournamentName: string | null;
  divisionCount: number;
  error: string | null;
}

/** Poll a submission's progress. Returns a null-status object if the id is unknown. */
export async function getIngestStatus(submissionId: string): Promise<IngestStatus> {
  const { data, error } = await aster.rpc("get_aau_ingest_status", { p_id: submissionId });
  if (error) throw error;
  return (
    (data as IngestStatus | null) ?? { status: null, tournamentId: null, tournamentName: null, divisionCount: 0, error: null }
  );
}
