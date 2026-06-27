import { Trophy } from "lucide-react";
import type { DirTournament } from "@/lib/aster";
import { fmtRange } from "@/lib/aau/dates";
import { initials, seasonOf, C } from "./findUi";
import LiveStrip from "./LiveStrip";

// Render state 01 "Front door" body (below the search box, which the orchestrator owns so it
// stays mounted across modes). Live strip (reads on load, hides if empty) + "Popular this
// weekend" = the top of the existing directory (no fabricated rows — real directory entries).

export default function FrontDoor({ dir, onOpen }: { dir: DirTournament[] | null; onOpen: (t: DirTournament) => void }) {
  const popular = (dir ?? []).slice(0, 5);
  return (
    <div className="as-fade-in">
      <LiveStrip />

      <div
        className="mx-[18px] mb-[9px] mt-[18px] flex items-center gap-[9px] font-[var(--font-mono)] text-[10px] uppercase tracking-[0.1em]"
        style={{ color: C.mut }}
      >
        Popular this weekend
        <span className="h-px flex-1" style={{ background: C.hair }} />
      </div>

      {dir === null ? (
        <div className="space-y-[10px] px-[18px]">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-[60px] animate-pulse rounded-[13px]" style={{ border: `1px solid ${C.hair}`, background: "rgba(16,20,31,.6)" }} />
          ))}
        </div>
      ) : popular.length === 0 ? (
        <div className="mx-[18px] rounded-[13px] p-6 text-center text-[12px]" style={{ border: `1px solid ${C.hair}`, background: "linear-gradient(180deg,#151b29,#10141f)", color: C.mut }}>
          No tournament on the board yet — paste a link to add the first one.
        </div>
      ) : (
        popular.map((t) => {
          const teamCount = t.divisions.reduce((a, d) => a + (d.team_count ?? 0), 0);
          return (
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
                </span>
                <span className="mt-[3px] block truncate font-[var(--font-mono)] text-[11px]" style={{ color: C.mut }}>
                  {[t.circuit, seasonOf(t.start_date), fmtRange(t.start_date, t.end_date), `${t.divisions.length} division${t.divisions.length === 1 ? "" : "s"}`].filter(Boolean).join(" · ")}
                </span>
              </span>
              <span className="shrink-0 rounded-[8px] px-[11px] py-[6px] font-[var(--font-mono)] text-[10px]" style={{ border: `1px solid ${C.line}`, color: C.dim }}>
                Open
              </span>
            </button>
          );
        })
      )}
    </div>
  );
}
