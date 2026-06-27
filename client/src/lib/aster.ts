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

// persistSession + detectSessionInUrl: the hub supports Google sign-in for account-synced
// tracking (the session lives in the browser, parsed from the OAuth redirect). Public reads
// keep working anonymously when signed out — the publishable key gates to org_is_public_listed
// data either way.
export const aster = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

// ─── Auth (Google sign-in) — account-synced tracking ───
export interface HubUser { id: string; email: string | null; name: string | null; avatar: string | null }

function mapUser(u: { id: string; email?: string | null; user_metadata?: Record<string, unknown> } | null | undefined): HubUser | null {
  if (!u) return null;
  const meta = u.user_metadata ?? {};
  return {
    id: u.id,
    email: u.email ?? null,
    name: (meta.full_name as string) ?? (meta.name as string) ?? null,
    avatar: (meta.avatar_url as string) ?? (meta.picture as string) ?? null,
  };
}

/** Start the Google OAuth redirect; the user returns to `redirectTo` (default: the hub).
 *  Pin the return to a CLEAN, fixed hub URL (`<origin>/aau`) rather than the live
 *  `window.location.href`: the live href can carry query/hash that won't exact-match the
 *  Supabase redirect allowlist, and an unmatched redirectTo silently falls back to the
 *  project Site URL (astersports.app) — so the hub never receives the session and the user
 *  looks "signed out." A single stable URL is also the one allowlist entry to maintain. */
export async function signInWithGoogle(redirectTo?: string): Promise<void> {
  const { error } = await aster.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: redirectTo ?? `${window.location.origin}/aau` },
  });
  if (error) throw error;
}

export async function signOutHub(): Promise<void> {
  await aster.auth.signOut();
}

export async function getHubUser(): Promise<HubUser | null> {
  const { data } = await aster.auth.getSession();
  return mapUser(data.session?.user);
}

/** Subscribe to auth changes; returns an unsubscribe fn. */
export function onHubAuth(cb: (u: HubUser | null) => void): () => void {
  const { data } = aster.auth.onAuthStateChange((_e, session) => cb(mapUser(session?.user)));
  return () => data.subscription.unsubscribe();
}

// ─── tracked_teams (account store; owner-only RLS on the backbone) ───
export interface TrackedRow {
  team_key: string; name: string; program: string | null; pool: string | null;
  tournament_id: string | null; tournament_name: string | null;
  division_id: string | null; division_name: string | null; kid: string | null;
}

export async function fetchTrackedTeams(): Promise<TrackedRow[]> {
  const { data, error } = await aster
    .from("tracked_teams")
    .select("team_key,name,program,pool,tournament_id,tournament_name,division_id,division_name,kid")
    .order("created_at");
  if (error) throw error;
  return (data as TrackedRow[]) ?? [];
}

export async function upsertTrackedTeams(userId: string, rows: TrackedRow[]): Promise<void> {
  if (!rows.length) return;
  const { error } = await aster
    .from("tracked_teams")
    .upsert(rows.map((r) => ({ ...r, user_id: userId })), { onConflict: "user_id,team_key" });
  if (error) throw error;
}

export async function deleteTrackedTeamRow(teamKey: string): Promise<void> {
  const { error } = await aster.from("tracked_teams").delete().eq("team_key", teamKey);
  if (error) throw error;
}

// ─── Shapes returned by get_public_tournament_standings (jsonb bundle) ───
export interface StandingsTeam {
  id: string; name: string; isOurs: boolean;
  /** cross-tournament opponent-adjusted margin rating; null when the team has no finals */
  rating?: number | null;
  /** completed games behind the rating (0 = no history) */
  gp?: number;
}
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
  states: string[]; // A6: DISTINCT venue states (geocoded), [] when unknown — null-honest
  divisions: DirDivision[];
}

/** Every public-listed tournament with its divisions. [] when nothing is public yet. */
export async function getTournamentDirectory(): Promise<DirTournament[]> {
  const { data, error } = await aster.rpc("get_public_tournament_directory");
  if (error) throw error;
  // The RPC is runtime-typed (cast, not validated). Normalize the array fields so a
  // missing/null `states` or `divisions` can never throw at a consumer (.length/.includes/
  // .map/.some). The RPC COALESCEs both to [] today; this is fail-safe defense (Copilot #154).
  return ((data as DirTournament[]) ?? []).map((t) => ({
    ...t,
    states: Array.isArray(t.states) ? t.states : [],
    divisions: Array.isArray(t.divisions) ? t.divisions : [],
  }));
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

/** Search teams by name across every public tournament (deduped). [] for queries
 *  under 2 chars. Normalizes (trim) once here so every caller hits the RPC with the
 *  same key and 1-char queries never reach the backend. */
export async function searchPublicTeams(query: string): Promise<TeamHit[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const { data, error } = await aster.rpc("search_public_teams", { p_query: q });
  if (error) throw error;
  return (data as TeamHit[]) ?? [];
}

// ─── Discovery search v2: typed { teams, tournaments, divisions }, value-in-row ───
// teams are FLAT variant rows carrying the authoritative teamKey (resolved_key) + a
// NON-AUTHORITATIVE programGroup hint the client nests on (see lib/aau/programGroups).
// record/rating/basis come straight from search_public_aau (same source as standings —
// no cross-surface divergence). search_public_teams (v1) stays for the legacy callers.
export interface AauTeamVariant {
  teamKey: string; name: string;
  programGroup: string | null;
  tournamentId: string; tournamentName: string;
  divisionId: string; divisionName: string;
  gender: string | null; gradeLabel: string | null; tier: string | null; day: string | null;
  record: { w: number; l: number };
  rating: number | null; basis: boolean; isLive: boolean;
}
export interface AauTournamentHit {
  tournamentId: string; name: string; circuit: string | null;
  startDate: string | null; endDate: string | null; divisionCount: number; isLive: boolean;
}
export interface AauDivisionHit {
  divisionId: string; label: string | null; tournamentName: string; teamCount: number;
}
export interface AauSearchResult {
  teams: AauTeamVariant[]; tournaments: AauTournamentHit[]; divisions: AauDivisionHit[];
}

const EMPTY_SEARCH: AauSearchResult = { teams: [], tournaments: [], divisions: [] };

/** Typed discovery search. [] sections for queries under 2 chars (never hits the RPC). */
export async function searchPublicAau(query: string): Promise<AauSearchResult> {
  const q = query.trim();
  if (q.length < 2) return EMPTY_SEARCH;
  const { data, error } = await aster.rpc("search_public_aau", { p_query: q });
  if (error) throw error;
  return (data as AauSearchResult) ?? EMPTY_SEARCH;
}

// ─── Live scores feed (the "Live" tab). Realtime tick is TECH-1 (deferred); this reads on load
// and the section polls. Currently-live public games across all public tournaments. ───
export interface LiveNowGame {
  gameId: string; startAt: string | null;
  homeName: string; awayName: string;
  homeScore: number | null; awayScore: number | null;
  divisionLabel: string | null; tournamentName: string;
}
/** Currently-live public games (most-recent first). [] when nothing is live. */
export async function getPublicLiveNow(limit = 40): Promise<LiveNowGame[]> {
  const { data, error } = await aster.rpc("get_public_live_now", { p_limit: limit });
  if (error) throw error;
  return (data as LiveNowGame[]) ?? [];
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

// ─── Tournament Detail scoreboard (one page for a whole tournament) ───
export interface TournamentGameVenue { name: string | null; city: string | null; state: string | null }
export interface TournamentGame {
  gameId: string;
  divisionId: string; divisionName: string;
  gender: "M" | "F" | "Coed" | null; gradeLabel: string | null; tier: string | null;
  startAt: string | null; court: string | null;
  status: "scheduled" | "live" | "final";
  home: string; homeScore: number | null;
  away: string; awayScore: number | null;
  venue: TournamentGameVenue | null;
}

/** Every game in a public tournament (display names + scores + court + venue + status),
 *  ordered by start time. Plane A read; [] when the tournament is empty/non-public. */
export async function getTournamentGames(tournamentId: string): Promise<TournamentGame[]> {
  const { data, error } = await aster.rpc("get_public_tournament_games", { p_tournament_id: tournamentId });
  if (error) throw error;
  return (data as TournamentGame[]) ?? [];
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
