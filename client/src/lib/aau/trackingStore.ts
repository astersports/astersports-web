// Tracked-teams store. PRE-ACCOUNT STUB: persists on-device in localStorage so the
// track flow is fully usable now. Phase A4 (Google sign-in) replaces this with an
// account-synced store — same shape, so callers don't change. A tracked entry keys on
// the stable team identity (name + program) so the team can FOLLOW across tournaments
// (design doc §3 "team-as-the-unit"); the originating tournament/division ride along as
// context for the first render.

import { parseProgram } from "./teamMeta";

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

// In-memory mirror so the session stays correct even when localStorage is unavailable
// (private mode / quota): write() always updates this, and read() falls back to it when
// storage can't be read. null = not yet hydrated this session.
let memCache: TrackedTeam[] | null = null;

function read(): TrackedTeam[] {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as TrackedTeam[]) : memCache ?? [];
    memCache = list;
    return list;
  } catch {
    return memCache ?? [];
  }
}

function write(list: TrackedTeam[]) {
  memCache = list; // always current, even if persistence fails
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* private mode / quota — non-fatal; memCache keeps the session correct */
  }
  // notify same-tab listeners (the storage event only fires in OTHER tabs)
  try {
    window.dispatchEvent(new CustomEvent(TRACKED_EVENT));
  } catch {
    /* SSR / no window — non-fatal */
  }
}

export function getTracked(): TrackedTeam[] {
  return read();
}

export function isTracked(teamKey: string): boolean {
  return read().some((t) => t.teamKey === teamKey);
}

/** Add teams to the tracked set (idempotent on teamKey). Returns the new full list. */
export function track(entries: Omit<TrackedTeam, "program" | "kid" | "addedAt">[]): TrackedTeam[] {
  const list = read();
  const seen = new Set(list.map((t) => t.teamKey));
  const now = Date.now();
  for (const e of entries) {
    if (seen.has(e.teamKey)) continue;
    list.push({ ...e, program: parseProgram(e.name), kid: null, addedAt: now });
    seen.add(e.teamKey);
  }
  write(list);
  return list;
}

export function untrack(teamKey: string): TrackedTeam[] {
  const list = read().filter((t) => t.teamKey !== teamKey);
  write(list);
  return list;
}
