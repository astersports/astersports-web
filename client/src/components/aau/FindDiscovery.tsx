import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Search, Link2, Trophy, ChevronRight, Loader2, Check, ArrowUpRight, Plus } from "lucide-react";
import {
  getTournamentDirectory,
  submitTournament,
  getIngestStatus,
  searchPublicTeams,
  type DirTournament,
  type TeamHit,
} from "@/lib/aster";
import { track, untrack, isTracked, getTracked, TRACKED_EVENT } from "@/lib/aau/trackingStore";
import { fmtRange } from "@/lib/aau/dates";

// Screen 01 Discovery — best-in-class render 01. Public + free to browse, and self-serve:
// a parent pastes their TourneyMachine link and the hub ingests it itself. FLAT tournament
// rows (no inline accordion); tapping a tournament opens Screen 02 "Track one or many".
// No invented data — every row is a real directory entry. Tokens = best-in-class palette.
type SubPhase = "idle" | "working" | "error" | "added";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default function FindDiscovery({ onOpenTournament }: { onOpenTournament: (t: DirTournament) => void }) {
  const [dir, setDir] = useState<DirTournament[] | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [q, setQ] = useState("");
  const [paste, setPaste] = useState("");
  const [sub, setSub] = useState<{ phase: SubPhase; msg?: string }>({ phase: "idle" });
  const [flashId, setFlashId] = useState<string | null>(null);
  const busy = sub.phase === "working";
  const alive = useRef(true);

  // Global team search — one query → the team across every public tournament.
  const [teamHits, setTeamHits] = useState<TeamHit[]>([]);
  const [trackedKeys, setTrackedKeys] = useState<Set<string>>(() => new Set(getTracked().map((t) => t.teamKey)));

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setTeamHits([]);
      return;
    }
    let live = true;
    const id = setTimeout(() => {
      searchPublicTeams(term)
        .then((hits) => live && setTeamHits(hits))
        .catch(() => live && setTeamHits([]));
    }, 220);
    return () => {
      live = false;
      clearTimeout(id);
    };
  }, [q]);

  const toggleTrack = (h: TeamHit) => {
    if (isTracked(h.teamKey)) untrack(h.teamKey);
    else
      track([
        {
          teamKey: h.teamKey,
          name: h.name,
          pool: null,
          tournamentId: h.tournamentId,
          tournamentName: h.tournamentName,
          divisionId: h.divisionId,
          divisionName: h.divisionName,
        },
      ]);
    setTrackedKeys(new Set(getTracked().map((t) => t.teamKey)));
  };

  // keep the Track/Tracked toggle fresh — same-tab track changes, cross-tab
  // storage writes, and tab focus (mirrors MyTeams) so it never reads stale.
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

  const loadDir = useCallback(async () => {
    const d = await getTournamentDirectory();
    if (alive.current) setDir(d);
    return d;
  }, []);

  useEffect(() => {
    alive.current = true;
    loadDir().catch((e) => alive.current && setError(e as Error));
    return () => {
      alive.current = false;
    };
  }, [loadDir]);

  // scroll to + flash a freshly-added tournament once it's in the list
  useEffect(() => {
    if (!flashId) return;
    const el = document.getElementById(`tg-${flashId}`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    const t = setTimeout(() => setFlashId(null), 2200);
    return () => clearTimeout(t);
  }, [flashId, dir]);

  async function finishAdd(id: string, name?: string | null) {
    await loadDir();
    if (!alive.current) return;
    setPaste("");
    setFlashId(id);
    setSub({ phase: "added", msg: name ? `Added ${name}` : "Added — it's on the board" });
  }

  async function handleSubmit(e?: React.FormEvent) {
    e?.preventDefault();
    const url = paste.trim();
    if (!url || busy) return;
    setSub({ phase: "working", msg: "Pulling in your tournament…" });
    const r = await submitTournament(url);
    if (!alive.current) return;
    if (!r.ok) return setSub({ phase: "error", msg: r.error });
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
          return setSub({ phase: "error", msg: "That tournament couldn't be imported. Double-check the link on TourneyMachine." });
        if (st.tournamentName) setSub({ phase: "working", msg: `Pulling in ${st.tournamentName}…` });
      }
      setSub({ phase: "error", msg: "This is taking a while — it may still appear shortly. Pull to refresh." });
    }
  }

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!dir) return [];
    if (!term) return dir;
    return dir.filter(
      (t) =>
        t.name.toLowerCase().includes(term) ||
        (t.circuit ?? "").toLowerCase().includes(term) ||
        t.divisions.some((d) => d.name.toLowerCase().includes(term)),
    );
  }, [dir, q]);

  return (
    <div className="as-fade-in">
      <div className="px-[18px]">
        <div className="font-[var(--font-mono)] text-[10px] uppercase tracking-[0.12em] text-[#cdb98c]">
          AAU Basketball · tracking
        </div>
        <h2 className="mt-1 font-[var(--font-display)] text-[23px] font-bold tracking-[-0.3px] text-[#f0f3fa]">
          Track any tournament
        </h2>
      </div>

      {/* search */}
      <div className="mx-[18px] mt-2 flex items-center gap-[11px] rounded-[15px] border border-[#212939] bg-[#151b29] px-[15px] py-[14px] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
        <Search className="h-[18px] w-[18px] shrink-0 text-[#5f6981]" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search tournament, team, or circuit"
          aria-label="Search tournaments or teams"
          className="w-full bg-transparent text-[13.5px] text-[#f0f3fa] placeholder-[#5f6981] outline-none"
        />
      </div>

      {/* global team-search results — the team across every tournament, tap → track */}
      {q.trim().length >= 2 && teamHits.length > 0 && (
        <div className="mx-[18px] mt-3">
          <div className="mb-2 font-[var(--font-mono)] text-[10px] uppercase tracking-[0.1em] text-[#5f6981]">
            Teams matching “{q.trim()}”
          </div>
          <div className="space-y-[8px]">
            {teamHits.map((h) => {
              const on = trackedKeys.has(h.teamKey);
              const meta = [
                [h.gender, h.gradeLabel].filter(Boolean).join(" ") || h.divisionName,
                h.tournamentName,
                fmtRange(h.startDate, h.endDate),
              ]
                .filter(Boolean)
                .join(" · ");
              return (
                <div
                  key={h.teamKey}
                  className="flex items-center gap-[11px] rounded-[14px] border border-[rgba(255,255,255,0.055)] bg-[linear-gradient(180deg,#151b29,#10141f)] px-[14px] py-[11px]"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-semibold text-[#f0f3fa]">{h.name}</span>
                    <small className="mt-0.5 block truncate font-[var(--font-mono)] text-[10px] text-[#5f6981]">{meta}</small>
                  </span>
                  <button
                    type="button"
                    onClick={() => toggleTrack(h)}
                    aria-pressed={on}
                    aria-label={`${on ? "Untrack" : "Track"} ${h.name} (${h.tournamentName})`}
                    className={`as-press flex shrink-0 items-center gap-1 rounded-full px-[12px] py-[6px] text-[11.5px] font-semibold ${
                      on
                        ? "border border-[rgba(94,203,143,0.4)] bg-[rgba(94,203,143,0.12)] text-[#5ecb8f]"
                        : "bg-[linear-gradient(100deg,#E0631C,#E8902A,#F6CC55,#FBD56B)] text-[#1a1206]"
                    }`}
                  >
                    {on ? (
                      <>
                        <Check className="h-[12px] w-[12px]" /> Tracked
                      </>
                    ) : (
                      <>
                        <Plus className="h-[12px] w-[12px]" /> Track
                      </>
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* paste-to-track */}
      <div className="mx-[18px] my-[13px] flex items-center gap-3 font-[var(--font-mono)] text-[10px] text-[#454e63]">
        <span className="h-px flex-1 bg-[rgba(255,255,255,0.055)]" />
        OR PASTE A LINK
        <span className="h-px flex-1 bg-[rgba(255,255,255,0.055)]" />
      </div>
      <form
        onSubmit={handleSubmit}
        className="mx-[18px] flex items-center gap-[10px] rounded-[15px] border border-dashed border-[#2a3346] bg-[rgba(232,144,42,0.03)] px-[13px] py-[10px]"
      >
        <Link2 className="h-[17px] w-[17px] shrink-0 text-[#E8902A]" />
        <input
          value={paste}
          onChange={(e) => {
            setPaste(e.target.value);
            if (sub.phase !== "working") setSub({ phase: "idle" });
          }}
          inputMode="url"
          placeholder="Paste a TourneyMachine link to track it"
          aria-label="Paste a TourneyMachine tournament link"
          disabled={busy}
          className="w-full bg-transparent text-[13px] text-[#f0f3fa] placeholder-[#5f6981] outline-none disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={busy || !paste.trim()}
          className="as-press flex shrink-0 items-center gap-1.5 rounded-[10px] bg-[linear-gradient(100deg,#E0631C,#E8902A,#F6CC55,#FBD56B)] px-[13px] py-[7px] text-[12px] font-bold text-[#1a1206] disabled:opacity-40"
        >
          {busy ? <Loader2 className="h-[13px] w-[13px] animate-spin" /> : null}
          Track
        </button>
      </form>

      {sub.phase === "working" && (
        <div className="mx-[18px] mt-2 flex items-center gap-2 text-[12px] text-[#9aa4ba]" aria-live="polite">
          <Loader2 className="h-[13px] w-[13px] animate-spin text-[#E8902A]" /> {sub.msg}
        </div>
      )}
      {sub.phase === "added" && (
        <div className="mx-[18px] mt-2 flex items-center gap-2 text-[12px] font-semibold text-[#5ecb8f]" aria-live="polite">
          <Check className="h-[13px] w-[13px]" /> {sub.msg}
        </div>
      )}
      {sub.phase === "error" && (
        <div className="mx-[18px] mt-2 text-[12px] leading-[1.45] text-[#ff8a7e]" aria-live="polite">
          {sub.msg}
        </div>
      )}
      <a
        href="https://tourneymachine.com/"
        target="_blank"
        rel="noopener noreferrer"
        className="mx-[18px] mt-2 inline-flex items-center gap-1 font-[var(--font-mono)] text-[10.5px] text-[#5f6981]"
      >
        Don't have the link? Search TourneyMachine <ArrowUpRight className="h-3 w-3" />
      </a>

      {/* directory */}
      <div className="mx-[18px] mb-[10px] mt-[18px] flex items-center gap-[10px] font-[var(--font-mono)] text-[10px] uppercase tracking-[0.1em] text-[#5f6981]">
        Live &amp; upcoming <span className="h-px flex-1 bg-[rgba(255,255,255,0.055)]" />
      </div>

      {error && (
        <div className="mx-[18px] rounded-[15px] border border-[rgba(255,255,255,0.055)] bg-[linear-gradient(180deg,#151b29,#10141f)] p-6 text-center text-[12px] text-[#5f6981]">
          Couldn't reach the directory. Try again in a moment.
        </div>
      )}
      {!dir && !error && (
        <div className="space-y-[10px] px-[18px]">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-[68px] animate-pulse rounded-[15px] border border-[rgba(255,255,255,0.055)] bg-[#10141f]/60" />
          ))}
        </div>
      )}
      {dir && filtered.length === 0 && (
        <div className="mx-[18px] rounded-[15px] border border-[rgba(255,255,255,0.055)] bg-[linear-gradient(180deg,#151b29,#10141f)] p-8 text-center">
          <Trophy className="mx-auto mb-3 h-7 w-7 text-[#5f6981]" />
          <div className="text-[14px] font-semibold text-[#f0f3fa]">{q ? "No match" : "No tournament on the board yet"}</div>
          <div className="mt-1 text-[12px] text-[#5f6981]">
            {q ? "Try a different search." : "Paste a TourneyMachine link above to add the first one."}
          </div>
        </div>
      )}

      {/* flat tournament rows — tap opens Screen 02 Track */}
      <div className="space-y-[10px] px-[18px]">
        {filtered.map((t) => {
          const teamCount = t.divisions.reduce((s, d) => s + (d.team_count ?? 0), 0);
          const flash = flashId === t.id;
          return (
            <button
              key={t.id}
              id={`tg-${t.id}`}
              type="button"
              onClick={() => onOpenTournament(t)}
              className={`as-press flex w-full items-center gap-[13px] rounded-[15px] border px-[15px] py-[14px] text-left transition-colors ${
                flash
                  ? "border-[rgba(94,203,143,0.5)] bg-[rgba(94,203,143,0.06)]"
                  : "border-[rgba(255,255,255,0.055)] bg-[linear-gradient(180deg,#151b29,#10141f)]"
              }`}
            >
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[12px] bg-[radial-gradient(circle_at_35%_30%,rgba(232,144,42,0.22),rgba(232,144,42,0.06))] text-[#F6CC55]">
                <Trophy className="h-[18px] w-[18px]" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-[var(--font-display)] text-[14px] font-bold text-[#f0f3fa]">{t.name}</span>
                <span className="mt-0.5 block truncate font-[var(--font-mono)] text-[11px] text-[#5f6981]">
                  {[
                    t.circuit,
                    fmtRange(t.start_date, t.end_date),
                    `${t.divisions.length} division${t.divisions.length === 1 ? "" : "s"}`,
                    teamCount ? `${teamCount} teams` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </span>
              <ChevronRight className="h-[17px] w-[17px] shrink-0 text-[#454e63]" />
            </button>
          );
        })}
      </div>

      <div className="mt-5 px-[18px] text-center font-[var(--font-mono)] text-[11px] leading-[1.5] text-[#5f6981]">
        Anyone can browse. Track teams to unlock the dashboard, alerts &amp; navigation.
      </div>
    </div>
  );
}
