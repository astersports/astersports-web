import { useCallback, useEffect, useRef, useState } from "react";
import { Search, Link2, Grid3x3 } from "lucide-react";
import {
  getTournamentDirectory,
  submitTournament,
  getIngestStatus,
  searchPublicAau,
  type DirTournament,
  type AauSearchResult,
  type AauTeamVariant,
} from "@/lib/aster";
import { track, untrack, isTracked as storeIsTracked, getTracked, TRACKED_EVENT } from "@/lib/aau/trackingStore";
import { C } from "./find/findUi";
import FrontDoor from "./find/FrontDoor";
import SearchResults from "./find/SearchResults";
import NoResults from "./find/NoResults";
import BrowseTree from "./find/BrowseTree";
import PastePanel, { type PasteUi } from "./find/PastePanel";

// Screen 01 "Find" — the public front door, rebuilt on the structured backbone (render contract
// aau-discovery-redesign-render.html; data/behavior spec aau-discovery-redesign-spec.txt). FIVE
// STATES OF ONE PAGE: front door, smart results, paste/ingest, browse, no-results. This is the
// ORCHESTRATOR: it owns the search box (mounted across modes), mode, data fetch, the preserved
// paste submit→poll flow, and the tracking toggle. The result-tap destination (Team Detail) is a
// SEPARATE screen — Find ends at the row + the tap (a team tap = track; a tournament/division tap
// opens via onOpenTournament). No fabricated data; every value resolves from its RPC at runtime.

type Mode = "search" | "browse" | "paste";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default function FindDiscovery({ onOpenTournament }: { onOpenTournament: (t: DirTournament) => void }) {
  const [dir, setDir] = useState<DirTournament[] | null>(null);
  const [dirError, setDirError] = useState<Error | null>(null);
  const [q, setQ] = useState("");
  const [mode, setMode] = useState<Mode>("search");
  const [focused, setFocused] = useState(false);
  const alive = useRef(true);

  // Search (state 02 / 05)
  const [results, setResults] = useState<AauSearchResult | null>(null);
  const [searching, setSearching] = useState(false);

  // Paste/ingest (state 03) — the EXISTING submit→poll behavior, preserved.
  const [paste, setPaste] = useState("");
  const [pasteUi, setPasteUi] = useState<PasteUi>({ kind: "idle" });
  const pasteBusy = pasteUi.kind === "working";

  // Tracking toggle
  const [trackedKeys, setTrackedKeys] = useState<Set<string>>(() => new Set(getTracked().map((t) => t.teamKey)));
  const isTracked = useCallback((key: string) => trackedKeys.has(key), [trackedKeys]);

  // ─── directory load (front door + browse + tournament-hit resolution) ───
  const loadDir = useCallback(async () => {
    const d = await getTournamentDirectory();
    if (alive.current) setDir(d);
    return d;
  }, []);

  useEffect(() => {
    alive.current = true;
    loadDir().catch((e) => alive.current && setDirError(e as Error));
    return () => {
      alive.current = false;
    };
  }, [loadDir]);

  // ─── debounced typed search (≥2 chars) → searchPublicAau ───
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setResults(null);
      setSearching(false);
      return;
    }
    let live = true;
    setSearching(true);
    const id = setTimeout(() => {
      searchPublicAau(term)
        .then((r) => {
          if (!live) return;
          setResults(r);
          setSearching(false);
        })
        .catch(() => {
          if (!live) return;
          setResults({ teams: [], tournaments: [], divisions: [] });
          setSearching(false);
        });
    }, 220);
    return () => {
      live = false;
      clearTimeout(id);
    };
  }, [q]);

  // keep the Track/Tracked toggle fresh across same-tab, cross-tab, and focus (mirrors MyTeams).
  useEffect(() => {
    const refresh = () => setTrackedKeys(new Set(getTracked().map((t) => t.teamKey)));
    window.addEventListener(TRACKED_EVENT, refresh);
    window.addEventListener("storage", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      window.removeEventListener(TRACKED_EVENT, refresh);
      window.removeEventListener("storage", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, []);

  const toggleTeam = useCallback((v: AauTeamVariant) => {
    if (storeIsTracked(v.teamKey)) untrack(v.teamKey);
    else
      track([
        {
          teamKey: v.teamKey,
          name: v.name,
          pool: null,
          tournamentId: v.tournamentId,
          tournamentName: v.tournamentName,
          divisionId: v.divisionId,
          divisionName: v.divisionName,
        },
      ]);
    setTrackedKeys(new Set(getTracked().map((t) => t.teamKey)));
  }, []);

  // Resolve a tournament hit (search/browse uses an id) to a DirTournament so the existing
  // onOpenTournament(DirTournament) prop contract holds. If the directory hasn't loaded the
  // hit yet, refetch once; if still absent, no-op (never fabricate a DirTournament).
  const openTournamentById = useCallback(
    async (tournamentId: string) => {
      const hit = (dir ?? []).find((t) => t.id === tournamentId);
      if (hit) return onOpenTournament(hit);
      const fresh = await loadDir().catch(() => null);
      const found = fresh?.find((t) => t.id === tournamentId);
      if (found) onOpenTournament(found);
    },
    [dir, loadDir, onOpenTournament],
  );

  // ─── paste submit → poll (preserved from the prior flow, restyled for state 03) ───
  async function finishAdd(id: string, name?: string | null) {
    await loadDir();
    if (!alive.current) return;
    setPaste("");
    setPasteUi({ kind: "done", msg: name ? `Added ${name} — it's on the board` : "Added — it's on the board" });
  }

  async function handlePaste(e?: React.FormEvent) {
    e?.preventDefault();
    const url = paste.trim();
    if (!url || pasteBusy) return;
    setPasteUi({ kind: "working", msg: "Reading the tournament…", divisions: null });
    const r = await submitTournament(url);
    if (!alive.current) return;
    if (!r.ok) return setPasteUi({ kind: "error", msg: r.error ?? "That didn't go through. Try again?" });
    if (r.status === "ready" && r.tournamentId) return finishAdd(r.tournamentId);
    if (r.status === "ingesting" && r.submissionId) {
      for (let i = 0; i < 24; i++) {
        await sleep(2000);
        if (!alive.current) return;
        let st;
        try {
          st = await getIngestStatus(r.submissionId);
        } catch {
          continue;
        }
        if (st.status === "ok" && st.tournamentId) return finishAdd(st.tournamentId, st.tournamentName);
        if (st.status === "error" || st.status === "missing")
          return setPasteUi({ kind: "error", msg: "That tournament couldn't be imported. Double-check the link." });
        setPasteUi({
          kind: "working",
          msg: st.tournamentName ? `Reading ${st.tournamentName}…` : "Reading the tournament…",
          divisions: st.divisionCount > 0 ? st.divisionCount : null,
        });
      }
      setPasteUi({ kind: "error", msg: "This is taking a while — it may still appear shortly. Pull to refresh." });
    }
  }

  // ─── what body to show ───
  const term = q.trim();
  const isSearchMode = mode === "search" && term.length >= 2;
  const noResults = isSearchMode && !searching && !!results && results.teams.length === 0 && results.tournaments.length === 0 && results.divisions.length === 0;

  return (
    <div className="as-fade-in">
      {/* header — varies by mode but the search box stays mounted in search mode */}
      {mode === "search" && term.length < 2 && (
        <div className="px-[18px] pt-[8px]">
          <div className="font-[var(--font-mono)] text-[10px] uppercase tracking-[0.12em]" style={{ color: "#cdb98c" }}>
            Find your team
          </div>
          <h2 className="mt-1 font-[var(--font-display)] text-[23px] font-bold tracking-[-0.3px]" style={{ color: C.ink }}>
            Who are you following?
          </h2>
          <div className="mt-[5px] text-[12.5px]" style={{ color: C.dim }}>
            A team, a tournament, a division — start typing.
          </div>
        </div>
      )}

      {/* search box (mounted in search mode across idle/results/no-results) */}
      {mode === "search" && (
        <div
          className="mx-[18px] mt-[14px] flex items-center gap-[10px] rounded-[15px] px-[15px] py-[14px]"
          style={{
            background: "linear-gradient(180deg,#1b2233,#10141f)",
            border: focused || term ? "1px solid rgba(246,204,85,.4)" : `1px solid ${C.hair2}`,
            boxShadow: focused || term ? "0 0 0 3px rgba(246,204,85,.08),0 10px 30px -16px rgba(0,0,0,.6)" : "0 10px 30px -16px rgba(0,0,0,.6)",
          }}
        >
          <Search className="h-[18px] w-[18px] shrink-0" style={{ color: C.g3 }} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder="Search teams, tournaments…"
            aria-label="Search teams, tournaments, or divisions"
            className="w-full bg-transparent text-[14px] outline-none"
            style={{ color: C.ink }}
          />
        </div>
      )}

      {/* path buttons — only on the bare front door */}
      {mode === "search" && term.length < 2 && (
        <div className="flex gap-[9px] px-[18px] pt-[11px]">
          <button
            type="button"
            onClick={() => setMode("paste")}
            className="as-press flex min-h-[44px] flex-1 items-center justify-center gap-[7px] rounded-[12px] text-[12px] font-semibold"
            style={{ border: `1px solid ${C.line}`, background: C.s2, color: C.dim }}
          >
            <Link2 className="h-[15px] w-[15px]" style={{ color: C.g2 }} /> Paste a link
          </button>
          <button
            type="button"
            onClick={() => setMode("browse")}
            className="as-press flex min-h-[44px] flex-1 items-center justify-center gap-[7px] rounded-[12px] text-[12px] font-semibold"
            style={{ border: `1px solid ${C.line}`, background: C.s2, color: C.dim }}
          >
            <Grid3x3 className="h-[15px] w-[15px]" style={{ color: C.g2 }} /> Browse all
          </button>
        </div>
      )}

      {/* back affordance for the secondary modes */}
      {mode !== "search" && (
        <button
          type="button"
          onClick={() => setMode("search")}
          className="as-press mx-[18px] mt-[2px] inline-flex min-h-[44px] items-center gap-1 font-[var(--font-mono)] text-[11px]"
          style={{ color: C.mut }}
        >
          ‹ Back to search
        </button>
      )}

      {/* ─── bodies ─── */}
      {mode === "browse" &&
        (dir === null ? (
          dirError ? (
            <div className="mx-[18px] mt-4 rounded-[15px] p-6 text-center text-[12px]" style={{ border: `1px solid ${C.hair}`, background: "linear-gradient(180deg,#151b29,#10141f)", color: C.mut }}>
              Couldn&apos;t reach the directory. Try again in a moment.
            </div>
          ) : (
            <div className="space-y-[10px] px-[18px] pt-4">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-[60px] animate-pulse rounded-[13px]" style={{ border: `1px solid ${C.hair}`, background: "rgba(16,20,31,.6)" }} />
              ))}
            </div>
          )
        ) : (
          <BrowseTree dir={dir} onOpen={onOpenTournament} />
        ))}

      {mode === "paste" && <PastePanel url={paste} onUrl={(v) => { setPaste(v); if (pasteUi.kind !== "working") setPasteUi({ kind: "idle" }); }} onSubmit={handlePaste} ui={pasteUi} disabled={pasteBusy} />}

      {mode === "search" && term.length < 2 && <FrontDoor dir={dir} onOpen={onOpenTournament} />}

      {isSearchMode && searching && !results && (
        <div className="space-y-[10px] px-[18px] pt-4" aria-live="polite">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-[56px] animate-pulse rounded-[13px]" style={{ border: `1px solid ${C.hair}`, background: "rgba(16,20,31,.6)" }} />
          ))}
        </div>
      )}

      {isSearchMode && results && !noResults && (
        <SearchResults result={results} isTracked={isTracked} onToggleTeam={toggleTeam} onOpenTournament={openTournamentById} />
      )}

      {noResults && (
        <NoResults
          query={q}
          onPaste={() => setMode("paste")}
          onRequest={() => {
            // "Ask us to add this tournament" — routes into the same paste/ingest funnel (the
            // real way in). No separate request RPC exists; the paste flow IS the request path.
            setMode("paste");
          }}
        />
      )}
    </div>
  );
}
