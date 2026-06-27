import { useEffect, useState } from "react";
import { ChevronRight, Trophy } from "lucide-react";
import { getTournamentDirectory, type DirTournament, type DirDivision } from "@/lib/aster";
import DivisionStandings from "./DivisionStandings";

/**
 * Standings hub (R1/R2 entry): browse the public tournament directory -> pick a division
 * -> live standings + bracket odds. Reads the aster-sports backbone (public RPC). A parent
 * can follow ANY division here, including programs we don't run (cross-program model).
 */
export default function StandingsHub() {
  const [dir, setDir] = useState<DirTournament[] | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [picked, setPicked] = useState<{ div: DirDivision } | null>(null);

  useEffect(() => {
    let active = true;
    getTournamentDirectory().then((d) => active && setDir(d)).catch((e) => active && setError(e as Error));
    return () => { active = false; };
  }, []);

  if (picked) {
    return (
      <div>
        <button onClick={() => setPicked(null)} className="mb-4 font-[var(--font-mono)] text-[11px] text-[#4A5568] hover:text-[#1A1D23]">‹ all divisions</button>
        <DivisionStandings divisionId={picked.div.id} divisionName={picked.div.name} />
      </div>
    );
  }

  if (error) return <div className="rounded-xl border border-[#E2E8F0] bg-[#FFFFFF] p-6 text-center text-[12px] text-[#6B7280]">Couldn't reach the directory. Try again in a moment.</div>;
  if (!dir) return <div className="space-y-3">{[0, 1].map((i) => <div key={i} className="h-16 animate-pulse rounded-xl border border-[#E2E8F0] bg-[#FFFFFF]/60" />)}</div>;

  if (dir.length === 0) {
    return (
      <div className="rounded-xl border border-[#E2E8F0] bg-[#FFFFFF] p-8 text-center">
        <Trophy className="mx-auto mb-3 h-7 w-7 text-[#6B7280]" />
        <div className="text-[14px] font-semibold text-[#1A1D23]">No tournament on the board yet</div>
        <div className="mt-1 text-[12px] text-[#6B7280]">Standings, brackets, and odds appear here once a tournament link is uploaded.</div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {dir.map((t) => (
        <div key={t.id}>
          <div className="mb-2 flex items-baseline gap-2">
            <span className="font-[var(--font-display)] text-[16px] font-bold text-[#1A1D23]">{t.name}</span>
            {t.circuit && <span className="font-[var(--font-mono)] text-[10.5px] text-[#6B7280]">{t.circuit}</span>}
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {t.divisions.map((d) => (
              <button
                key={d.id}
                onClick={() => setPicked({ div: d })}
                className="flex items-center gap-3 rounded-xl border border-[#E2E8F0] bg-[#FFFFFF] px-4 py-3 text-left transition-colors hover:bg-[#FFFFFF]"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13.5px] font-semibold text-[#1A1D23]">{d.name}</div>
                  <div className="font-[var(--font-mono)] text-[10.5px] text-[#6B7280]">
                    {d.team_count} teams · top {d.advance_count} advance
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 text-[#6B7280]" />
              </button>
            ))}
            {t.divisions.length === 0 && (
              <div className="text-[12px] text-[#6B7280]">Divisions load as the tournament is scraped.</div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
