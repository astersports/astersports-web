import { useEffect, useState } from "react";
import { ChevronRight, Trophy } from "lucide-react";
import { getTournamentDirectory, type DirTournament, type DirDivision } from "@/lib/aster";
import DivisionStandings from "./DivisionStandings";
import AgentConsole, { type AgentStep } from "../AgentConsole";

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
        <button onClick={() => setPicked(null)} className="mb-4 font-[var(--font-mono)] text-[12.6px] text-[#374151] hover:text-[#1A1D23]">‹ all divisions</button>
        <DivisionStandings divisionId={picked.div.id} divisionName={picked.div.name} />
      </div>
    );
  }

  if (error) return <div className="rounded-xl border border-[#E2E8F0] bg-[#FFFFFF] p-6 text-center text-[13.8px] text-[#4B5563]">Couldn't reach the directory. Try again in a moment.</div>;
  if (!dir) return <div className="space-y-3">{[0, 1].map((i) => <div key={i} className="h-16 animate-pulse rounded-xl border border-[#E2E8F0] bg-[#FFFFFF]/60" />)}</div>;

  if (dir.length === 0) {
    return (
      <div className="rounded-xl border border-[#E2E8F0] bg-[#FFFFFF] p-8 text-center">
        <Trophy className="mx-auto mb-3 h-7 w-7 text-[#4B5563]" />
        <div className="text-[14.6px] font-semibold text-[#1A1D23]">No tournament on the board yet</div>
        <div className="mt-1 text-[13.8px] text-[#4B5563]">Standings, brackets, and odds appear here once a tournament link is uploaded.</div>
      </div>
    );
  }

  const totalDivs = dir.reduce((n, t) => n + t.divisions.length, 0);
  const withCut = dir.reduce((n, t) => n + t.divisions.filter((d) => d.advance_count).length, 0);
  const standingsSteps: AgentStep[] = [
    { tag: "Tournaments", line: `${dir.length} on the board` },
    { tag: "Divisions", line: `${totalDivs} live bracket${totalDivs === 1 ? "" : "s"}` },
    { tag: "Cut line", line: withCut ? `${withCut} with a top-N cut set` : "advancement rules resolving" },
    { tag: "Standings", line: "rule-driven, recomputed on every result" },
  ];

  return (
    <div className="space-y-5">
      <AgentConsole label="aster-agent · standings" verb="computing" steps={standingsSteps} />
      {dir.map((t) => (
        <div key={t.id}>
          <div className="mb-2 flex items-baseline gap-2">
            <span className="font-[var(--font-display)] text-[18.4px] font-bold text-[#1A1D23]">{t.name}</span>
            {t.circuit && <span className="font-[var(--font-mono)] text-[12.1px] text-[#4B5563]">{t.circuit}</span>}
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {t.divisions.map((d) => (
              <button
                key={d.id}
                onClick={() => setPicked({ div: d })}
                aria-label={`${d.name} standings — ${t.name}`}
                className="as-press flex min-h-[44px] items-center gap-3 rounded-xl border border-[#E2E8F0] bg-[#FFFFFF] px-4 py-3 text-left transition-colors hover:bg-[#F9FAFB]"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[14.1px] font-semibold text-[#1A1D23]">{d.name}</div>
                  <div className="font-[var(--font-mono)] text-[12.1px] text-[#4B5563]">
                    {[`${d.team_count} teams`, d.advance_count ? `top ${d.advance_count} advance` : null].filter(Boolean).join(" · ")}
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 text-[#4B5563]" />
              </button>
            ))}
            {t.divisions.length === 0 && (
              <div className="text-[13.8px] text-[#4B5563]">Divisions load as the tournament is scraped.</div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
