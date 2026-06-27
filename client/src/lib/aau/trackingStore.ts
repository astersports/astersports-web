// Tracked-teams store. Account-aware: signed in (Google) the set lives on the backbone
// (tracked_teams, owner-only RLS) and follows the user across devices; signed out it
// persists on-device in localStorage so tracking works without an account. The public API
// stays SYNCHRONOUS (an in-memory cache) so the consumers don't change — reads hit the
// cache, writes update it + emit TRACKED_EVENT optimistically, then persist async. On first
// sign-in, any on-device tracks migrate up to the account so nothing is stranded.

import { parseProgram } from "./teamMeta";
import { fetchTrackedTeams, upsertTrackedTeams, deleteTrackedTeamRow, type TrackedRow } from "@/lib/aster";

export interface TrackedTeam {
  teamKey: string;      // resolved_key from the RPC (stable per team within a division)
  name: string;
  program: string;
  pool: string | null;
  tournamentId: string;
  tournamentName: string;
  divisionId: string;
  divisionName: string;
  kid: string | null;   // free-form kid label (D5), assigned later; null = watch-only
  addedAt: number;
}

const KEY = "aau.tracked.v1";
export const TRACKED_EVENT = "aau:tracked-changed";

// In-memory cache = the source of truth for synchronous reads. Hydrated from localStorage at
// load, swapped to the account set on sign-in. Every mutation reassigns it (new ref) so React
// consumers re-render off TRACKED_EVENT.
let mem: TrackedTeam[] = readLocal();
let uid: string | null = null; // null = anon (localStorage), non-null = account-synced

function readLocal(): TrackedTeam[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as TrackedTeam[]) : [];
  } catch {
    return [];
  }
}
function writeLocal(list: TrackedTeam[]) {
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* private mode / quota */ }
}
function emit() {
  try { window.dispatchEvent(new CustomEvent(TRACKED_EVENT)); } catch { /* SSR / no window */ }
}

function toRow(t: TrackedTeam): TrackedRow {
  return {
    team_key: t.teamKey, name: t.name, program: t.program, pool: t.pool,
    tournament_id: t.tournamentId || null, tournament_name: t.tournamentName || null,
    division_id: t.divisionId || null, division_name: t.divisionName || null, kid: t.kid,
  };
}
function fromRow(r: TrackedRow): TrackedTeam {
  return {
    teamKey: r.team_key, name: r.name, program: r.program || parseProgram(r.name), pool: r.pool,
    tournamentId: r.tournament_id || "", tournamentName: r.tournament_name || "",
    divisionId: r.division_id || "", divisionName: r.division_name || "", kid: r.kid, addedAt: 0,
  };
}

export function getTracked(): TrackedTeam[] {
  return mem;
}

export function isTracked(teamKey: string): boolean {
  return mem.some((t) => t.teamKey === teamKey);
}

/**
 * Switch the store between anon (localStorage) and account-synced. Call on every auth change.
 * On sign-in: migrate any on-device tracks up to the account (so this device's teams follow
 * the user), then read the account set as the source of truth. On sign-out: fall back to
 * whatever is on this device. Always emits so consumers re-read.
 */
export async function setAuthUser(userId: string | null): Promise<void> {
  if (userId) {
    uid = userId;
    try {
      const local = readLocal();
      if (local.length) await upsertTrackedTeams(userId, local.map(toRow)); // device → account
      mem = (await fetchTrackedTeams()).map(fromRow);
      try { localStorage.removeItem(KEY); } catch { /* account is the source of truth now */ }
    } catch { /* on failure keep the current cache; reads still work */ }
  } else {
    uid = null;
    mem = readLocal();
  }
  emit();
}

/** Add teams to the tracked set (idempotent on teamKey). Returns the new full list. */
export function track(entries: Omit<TrackedTeam, "program" | "kid" | "addedAt">[]): TrackedTeam[] {
  const seen = new Set(mem.map((t) => t.teamKey));
  const added: TrackedTeam[] = [];
  for (const e of entries) {
    if (seen.has(e.teamKey)) continue;
    added.push({ ...e, program: parseProgram(e.name), kid: null, addedAt: Date.now() });
    seen.add(e.teamKey);
  }
  if (added.length) {
    mem = [...mem, ...added];
    if (uid) upsertTrackedTeams(uid, added.map(toRow)).catch(() => {});
    else writeLocal(mem);
    emit();
  }
  return mem;
}

export function untrack(teamKey: string): TrackedTeam[] {
  mem = mem.filter((t) => t.teamKey !== teamKey);
  if (uid) deleteTrackedTeamRow(teamKey).catch(() => {});
  else writeLocal(mem);
  emit();
  return mem;
}
