import { Trophy, Grid3x3, Link2, FileUp, PencilLine } from "lucide-react";
import type { DirTournament } from "@/lib/aster";
import { fmtRange, etTodayISO, tournamentTimeState } from "@/lib/aau/dates";
import { initials, C } from "./findUi";
import BrowseLiveStrip from "./BrowseLiveStrip";

// Browse front door (below the search box, which the orchestrator owns so it stays mounted across
// modes). North Star: Browse discovers/tracks AND uploads. A LIVE-now section rides at the top
// (Live is a section in Browse, not a tab), then LIVE + UPCOMING tournaments (past ones under Browse
// all), then the "Add a tournament" upload panel. No fabricated rows.

export default function FrontDoor({ dir, onOpen, onBrowseAll, onAddTournament }: { dir: DirTournament[] | null; onOpen: (t: DirTournament) => void; onBrowseAll: () => void; onAddTournament: () => void }) {
  const today = etTodayISO();
  // live first (in progress), then upcoming by soonest start; past tournaments live under Browse all.
  const liveUpcoming = (dir ?? [])
    .map((t) => ({ t, state: tournamentTimeState(t.start_date, t.end_date, today) }))
    .filter((x) => x.state !== "past")
    .sort((a, b) => {
      if (a.state !== b.state) return a.state === "live" ? -1 : 1;
      return a.t.start_date < b.t.start_date ? -1 : a.t.start_date > b.t.start_date ? 1 : 0;
    });

  const browseAll = (
    <button
      type="button"
      onClick={onBrowseAll}
      className="as-press mx-[18px] mt-[14px] flex min-h-[44px] w-[calc(100%-36px)] items-center justify-center gap-[7px] rounded-[12px] text-[12px] font-semibold"
      style={{ border: `1px solid ${C.line}`, background: C.s2, color: C.dim }}
    >
      <Grid3x3 className="h-[15px] w-[15px]" style={{ color: C.g2 }} /> Browse all tournaments
    </button>
  );

  // "Add a tournament" — events not yet in the system. Paste routes through the SAME ingest +
  // normalize path as the scraper (external_team_key, circuit classification, geocode) — no side
  // door (North Star §5). File-upload / enter-by-hand are honest pre-gate (not wired) — they say so
  // rather than pretend; the paste path is the working ingress today.
  const addTournament = (
    <div className="mx-[18px] mt-[16px] rounded-[14px] p-[13px]" style={{ border: `1px dashed ${C.hair2}`, background: "linear-gradient(160deg,rgba(224,99,28,.05),#FFFFFF)" }}>
      <div className="flex items-center justify-between gap-2">
        <div className="font-[var(--font-display)] text-[13.5px] font-bold" style={{ color: C.ink }}>Don&apos;t see your tournament?</div>
        <span className="shrink-0 rounded-[6px] px-[7px] py-[2px] font-[var(--font-mono)] text-[9px] font-bold tracking-[0.06em]" style={{ color: C.g3, border: "1px solid rgba(246,204,85,.35)", background: "rgba(246,204,85,.08)" }}>PLUS</span>
      </div>
      <div className="mt-[4px] text-[11px] leading-[1.45]" style={{ color: C.mut }}>Add it with Aster Plus — we&apos;ll ingest the schedule, divisions, and teams through the same pipeline the scraper uses.</div>
      <div className="mt-[11px] flex gap-[7px]">
        <button type="button" onClick={onAddTournament} className="as-press flex flex-1 flex-col items-center gap-[4px] rounded-[10px] px-[6px] py-[9px] text-[10.5px] font-semibold" style={{ border: `1px solid ${C.line}`, background: "rgba(0,0,0,.2)", color: C.dim }}>
          <Link2 className="h-[16px] w-[16px]" style={{ color: C.g2 }} /> Paste link
        </button>
        <div className="flex flex-1 flex-col items-center gap-[4px] rounded-[10px] px-[6px] py-[9px] text-[10.5px] font-semibold" style={{ border: `1px solid ${C.hair}`, background: "rgba(0,0,0,.12)", color: C.faint }} aria-disabled>
          <FileUp className="h-[16px] w-[16px]" style={{ color: C.faint }} /> Upload file
          <span className="font-[var(--font-mono)] text-[8px]" style={{ color: C.faint }}>soon</span>
        </div>
        <div className="flex flex-1 flex-col items-center gap-[4px] rounded-[10px] px-[6px] py-[9px] text-[10.5px] font-semibold" style={{ border: `1px solid ${C.hair}`, background: "rgba(0,0,0,.12)", color: C.faint }} aria-disabled>
          <PencilLine className="h-[16px] w-[16px]" style={{ color: C.faint }} /> By hand
          <span className="font-[var(--font-mono)] text-[8px]" style={{ color: C.faint }}>soon</span>
        </div>
      </div>
    </div>
  );

  return (
    <div className="as-fade-in">
      {/* Live games ride at the top of Browse (Live is a section here, not a tab); self-hides */}
      <div className="mt-[14px]">
        <BrowseLiveStrip />
      </div>

      <div
        className="mx-[18px] mb-[9px] mt-[18px] flex items-center gap-[9px] font-[var(--font-mono)] text-[10px] uppercase tracking-[0.1em]"
        style={{ color: C.mut }}
      >
        Live &amp; upcoming
        <span className="h-px flex-1" style={{ background: C.hair }} />
      </div>

      {dir === null ? (
        <div className="space-y-[10px] px-[18px]">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-[60px] animate-pulse rounded-[13px]" style={{ border: `1px solid ${C.hair}`, background: "rgba(0,0,0,0.04)" }} />
          ))}
        </div>
      ) : liveUpcoming.length === 0 ? (
        <div className="mx-[18px] rounded-[13px] p-6 text-center text-[12px]" style={{ border: `1px solid ${C.hair}`, background: "linear-gradient(180deg,#F9FAFB,#FFFFFF)", color: C.mut }}>
          Nothing live or upcoming on the board right now — browse past tournaments or paste a link to add one.
        </div>
      ) : (
        liveUpcoming.map(({ t, state }) => (
          <button
            key={t.id}
            type="button"
            onClick={() => onOpen(t)}
            className="as-press flex w-full items-center gap-[12px] px-[18px] py-[11px] text-left"
            style={{ borderTop: `1px solid ${C.hair}` }}
          >
            <span
              className="grid h-[38px] w-[38px] shrink-0 place-items-center rounded-[11px] font-[var(--font-display)] text-[15px] font-bold"
              style={{ background: "rgba(232,144,42,.13)", color: C.g3, border: "1px solid #E2C98A" }}
              aria-hidden
            >
              {initials(t.name)}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-[7px]">
                <Trophy className="h-[13px] w-[13px] shrink-0" style={{ color: C.g3 }} aria-hidden />
                <span className="truncate font-[var(--font-display)] text-[14px] font-semibold" style={{ color: C.ink }}>
                  {t.name}
                </span>
                {state === "live" && (
                  <span className="inline-flex shrink-0 items-center gap-[5px] rounded-[6px] px-[6px] py-[2px] font-[var(--font-mono)] text-[9px] font-bold" style={{ color: C.live, border: "1px solid rgba(52,224,164,.35)", background: "rgba(52,224,164,.08)" }}>
                    <span className="as-pulse inline-block h-[5px] w-[5px] rounded-full" style={{ background: C.live }} aria-hidden /> LIVE
                  </span>
                )}
              </span>
              <span className="mt-[3px] block truncate font-[var(--font-mono)] text-[11px]" style={{ color: C.mut }}>
                {[t.circuit, fmtRange(t.start_date, t.end_date), `${t.divisions.length} division${t.divisions.length === 1 ? "" : "s"}`].filter(Boolean).join(" · ")}
              </span>
            </span>
            <span className="shrink-0 rounded-[8px] px-[11px] py-[6px] font-[var(--font-mono)] text-[10px]" style={{ border: `1px solid ${C.line}`, color: C.dim }}>
              Open
            </span>
          </button>
        ))
      )}

      {browseAll}
      {addTournament}
    </div>
  );
}
