import { Trophy, Grid3x3 } from "lucide-react";
import type { DirTournament } from "@/lib/aster";
import { fmtRange, etTodayISO, tournamentTimeState } from "@/lib/aau/dates";
import { initials, C } from "./findUi";

// Render state 01 "Front door" body (below the search box, which the orchestrator owns so it
// stays mounted across modes). The main page is LIVE + UPCOMING tournaments only (operator-directed
// 2026-06-27 — the live-game-score strip moved to the Tournament Detail page; Find is discovery
// only), then a "Browse all" entry into the full directory. No fabricated rows.

export default function FrontDoor({ dir, onOpen, onBrowseAll }: { dir: DirTournament[] | null; onOpen: (t: DirTournament) => void; onBrowseAll: () => void }) {
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

  return (
    <div className="as-fade-in">
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
            <div key={i} className="h-[60px] animate-pulse rounded-[13px]" style={{ border: `1px solid ${C.hair}`, background: "rgba(16,20,31,.6)" }} />
          ))}
        </div>
      ) : liveUpcoming.length === 0 ? (
        <div className="mx-[18px] rounded-[13px] p-6 text-center text-[12px]" style={{ border: `1px solid ${C.hair}`, background: "linear-gradient(180deg,#151b29,#10141f)", color: C.mut }}>
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
              style={{ background: "rgba(232,144,42,.13)", color: C.g3, border: "1px solid #5a4a25" }}
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
    </div>
  );
}
