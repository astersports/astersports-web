import { useEffect, useMemo, useState } from "react";
import { Search, Link2, Trophy, ChevronRight } from "lucide-react";
import { getTournamentDirectory, type DirTournament, type DirDivision } from "@/lib/aster";

// Find / Discovery (render set v2 · render 01). Search the public tournament
// directory, browse tournament → division, or jump to TourneyMachine. Public + free
// to browse; picking a division sends the hub to Standings for it. Self-serve
// paste-a-link ingest is a gated fast-follow — for now Find browses what's loaded.
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
      <div className="px-1">
        <div className="font-[var(--font-mono)] text-[10px] uppercase tracking-[0.1em] text-[#cbb98f]">
          AAU Basketball · tracking
        </div>
        <h2 className="mt-1 font-[var(--font-display)] text-[21px] font-bold text-[#eef1f8]">
          Track any tournament
        </h2>
      </div>

      {/* search */}
      <div className="mt-3 flex items-center gap-2 rounded-[13px] border border-[#2c3548] bg-[#171d2c] px-3 py-3">
        <Search className="h-[17px] w-[17px] shrink-0 text-[#6b7488]" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search tournament, division, or circuit"
          aria-label="Search tournaments"
          className="w-full bg-transparent text-[13px] text-[#eef1f8] placeholder-[#6b7488] outline-none"
        />
      </div>

      {/* paste / TourneyMachine entry */}
      <div className="my-3 flex items-center gap-2.5 px-1 font-[var(--font-mono)] text-[10px] text-[#6b7488]">
        <span className="h-px flex-1 bg-[#222a39]" />
        or
        <span className="h-px flex-1 bg-[#222a39]" />
      </div>
      <a
        href="https://tourneymachine.com/"
        target="_blank"
        rel="noopener noreferrer"
        className="as-press flex items-center gap-2.5 rounded-[13px] border border-dashed border-[#2c3548] bg-[#131825] px-3 py-3"
      >
        <Link2 className="h-4 w-4 shrink-0 text-[#E8902A]" />
        <span className="text-[12.5px] text-[#9aa3b6]">Find a tournament on TourneyMachine…</span>
      </a>

      {/* directory */}
      <div className="mb-2 mt-4 flex items-center gap-2 px-1 font-[var(--font-mono)] text-[10px] uppercase tracking-[0.09em] text-[#6b7488]">
        Live &amp; upcoming <span className="h-px flex-1 bg-[#222a39]" />
      </div>

      {error && (
        <div className="rounded-xl border border-[#222a39] bg-[#131825] p-6 text-center text-[12px] text-[#6b7488]">
          Couldn't reach the directory. Try again in a moment.
        </div>
      )}
      {!dir && !error && (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-14 animate-pulse rounded-xl border border-[#222a39] bg-[#131825]/60" />
          ))}
        </div>
      )}
      {dir && filtered.length === 0 && (
        <div className="rounded-xl border border-[#222a39] bg-[#131825] p-8 text-center">
          <Trophy className="mx-auto mb-3 h-7 w-7 text-[#6b7488]" />
          <div className="text-[14px] font-semibold text-[#eef1f8]">
            {q ? "No match" : "No tournament on the board yet"}
          </div>
          <div className="mt-1 text-[12px] text-[#6b7488]">
            {q ? "Try a different search." : "Tournaments appear here as links are uploaded."}
          </div>
        </div>
      )}

      <div className="space-y-4">
        {filtered.map((t) => (
          <div key={t.id}>
            <div className="mb-2 flex items-baseline gap-2 px-1">
              <span className="font-[var(--font-display)] text-[15px] font-bold text-[#eef1f8]">{t.name}</span>
              {t.circuit && <span className="font-[var(--font-mono)] text-[10px] text-[#6b7488]">{t.circuit}</span>}
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {t.divisions.map((d) => (
                <button
                  key={d.id}
                  onClick={() => onPick(d, t.name)}
                  className="as-press flex items-center gap-3 rounded-xl border border-[#222a39] bg-[#131825] px-4 py-3 text-left transition-colors hover:bg-[#171d2c]"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-semibold text-[#eef1f8]">{d.name}</div>
                    <div className="font-[var(--font-mono)] text-[10px] text-[#6b7488]">
                      {d.team_count} teams · top {d.advance_count} advance
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-[#6b7488]" />
                </button>
              ))}
              {t.divisions.length === 0 && (
                <div className="px-1 text-[12px] text-[#6b7488]">Divisions load as the tournament is scraped.</div>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-5 px-1 text-center font-[var(--font-mono)] text-[11px] text-[#6b7488]">
        Anyone can browse. Tracking unlocks alerts &amp; navigation.
      </div>
    </div>
  );
}
