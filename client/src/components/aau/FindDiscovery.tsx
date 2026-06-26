import { useEffect, useMemo, useState } from "react";
import { Search, Link2, Trophy, ChevronRight } from "lucide-react";
import { getTournamentDirectory, type DirTournament, type DirDivision } from "@/lib/aster";

// Find / Discovery — best-in-class render 01. Search the public tournament directory,
// browse tournament → division, or jump to TourneyMachine. Public + free to browse;
// picking a division sends the hub to Standings for it. Self-serve paste-a-link ingest
// is a gated fast-follow — for now Find browses what's loaded. Tokens = best-in-class
// palette (§1, do not eyeball). No invented data — every row is a real directory entry.
export default function FindDiscovery({
  onPick,
}: {
  onPick: (div: DirDivision, tournamentName: string) => void;
}) {
  const [dir, setDir] = useState<DirTournament[] | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    let active = true;
    getTournamentDirectory()
      .then((d) => active && setDir(d))
      .catch((e) => active && setError(e as Error));
    return () => {
      active = false;
    };
  }, []);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!dir) return [];
    if (!term) return dir;
    return dir
      .map((t) => {
        const tMatch =
          t.name.toLowerCase().includes(term) || (t.circuit ?? "").toLowerCase().includes(term);
        return tMatch ? t : { ...t, divisions: t.divisions.filter((d) => d.name.toLowerCase().includes(term)) };
      })
      .filter(
        (t) =>
          t.name.toLowerCase().includes(term) ||
          (t.circuit ?? "").toLowerCase().includes(term) ||
          t.divisions.length > 0,
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
          placeholder="Search tournament, division, or circuit"
          aria-label="Search tournaments"
          className="w-full bg-transparent text-[13.5px] text-[#f0f3fa] placeholder-[#5f6981] outline-none"
        />
      </div>

      {/* paste / TourneyMachine */}
      <div className="mx-[18px] my-[13px] flex items-center gap-3 font-[var(--font-mono)] text-[10px] text-[#454e63]">
        <span className="h-px flex-1 bg-[rgba(255,255,255,0.055)]" />
        OR
        <span className="h-px flex-1 bg-[rgba(255,255,255,0.055)]" />
      </div>
      <a
        href="https://tourneymachine.com/"
        target="_blank"
        rel="noopener noreferrer"
        className="as-press mx-[18px] flex items-center gap-[11px] rounded-[15px] border border-dashed border-[#212939] bg-[rgba(232,144,42,0.03)] px-[15px] py-[14px]"
      >
        <Link2 className="h-[17px] w-[17px] shrink-0 text-[#E8902A]" />
        <span className="text-[13px] text-[#9aa4ba]">Find a tournament on TourneyMachine…</span>
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
          <div className="text-[14px] font-semibold text-[#f0f3fa]">
            {q ? "No match" : "No tournament on the board yet"}
          </div>
          <div className="mt-1 text-[12px] text-[#5f6981]">
            {q ? "Try a different search." : "Tournaments appear here as links are uploaded."}
          </div>
        </div>
      )}

      <div className="space-y-0">
        {filtered.map((t) => (
          <div key={t.id} className="mt-[18px] first:mt-0">
            <div className="mb-1 flex items-baseline gap-2 px-[18px]">
              <span className="font-[var(--font-display)] text-[14px] font-bold text-[#f0f3fa]">{t.name}</span>
              {t.circuit && <span className="font-[var(--font-mono)] text-[10px] text-[#5f6981]">{t.circuit}</span>}
            </div>
            {t.divisions.map((d) => (
              <button
                key={d.id}
                onClick={() => onPick(d, t.name)}
                className="as-press mx-[18px] mt-[10px] flex w-[calc(100%-36px)] items-center gap-[13px] rounded-[15px] border border-[rgba(255,255,255,0.055)] bg-[linear-gradient(180deg,#151b29,#10141f)] px-[15px] py-[14px] text-left"
              >
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[12px] bg-[radial-gradient(circle_at_35%_30%,rgba(232,144,42,0.22),rgba(232,144,42,0.06))] text-[#F6CC55]">
                  <Trophy className="h-[18px] w-[18px]" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13.5px] font-semibold text-[#f0f3fa]">{d.name}</div>
                  <div className="mt-0.5 font-[var(--font-mono)] text-[11px] text-[#5f6981]">
                    {d.team_count} teams · top {d.advance_count} advance
                  </div>
                </div>
                <ChevronRight className="h-[17px] w-[17px] shrink-0 text-[#454e63]" />
              </button>
            ))}
            {t.divisions.length === 0 && (
              <div className="px-[18px] pt-2 text-[12px] text-[#5f6981]">Divisions load as the tournament is scraped.</div>
            )}
          </div>
        ))}
      </div>

      <div className="mt-5 px-[18px] text-center font-[var(--font-mono)] text-[11px] leading-[1.5] text-[#5f6981]">
        Anyone can browse. Track teams to unlock the dashboard, alerts &amp; navigation.
      </div>
    </div>
  );
}
