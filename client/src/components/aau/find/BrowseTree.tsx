import { useMemo, useState } from "react";
import type { DirTournament } from "@/lib/aster";
import { fmtRange } from "@/lib/aau/dates";
import { seasonOf, C } from "./findUi";

// Render state 04 "Browse by structure" — circuit → season+year → tournament tree over the
// EXISTING directory (get_tournament_directory). Filter chips are visual-forward: the cheap
// ones wire over directory data we already have (gender/grade via division columns,
// live & upcoming via date). We do NOT invent a division-browse RPC (deferred, spec §R3 note).
// Default scope: live & upcoming.

const GENDER_CHIPS = [
  { id: "F", label: "Girls" },
  { id: "M", label: "Boys" },
] as const;

type GenderFilter = "F" | "M" | null;

function tournamentMatchesGender(t: DirTournament, g: GenderFilter): boolean {
  if (!g) return true;
  return t.divisions.some((d) => d.gender === g);
}

function isUpcomingOrLive(t: DirTournament): boolean {
  // "live & upcoming" = the tournament's end date is today or later (date-only ISO from scrape).
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const end = new Date(`${t.end_date}T00:00:00`);
  return !Number.isNaN(end.getTime()) && end.getTime() >= today.getTime();
}

interface CircuitGroup {
  circuit: string;
  seasons: { season: string; tournaments: DirTournament[] }[];
}

function buildTree(dir: DirTournament[]): CircuitGroup[] {
  const byCircuit = new Map<string, Map<string, DirTournament[]>>();
  dir.forEach((t) => {
    const circuit = t.circuit?.trim() || "Other";
    const season = seasonOf(t.start_date);
    if (!byCircuit.has(circuit)) byCircuit.set(circuit, new Map());
    const seasons = byCircuit.get(circuit)!;
    if (!seasons.has(season)) seasons.set(season, []);
    seasons.get(season)!.push(t);
  });
  const out: CircuitGroup[] = [];
  byCircuit.forEach((seasons, circuit) => {
    const seasonList: { season: string; tournaments: DirTournament[] }[] = [];
    seasons.forEach((tournaments, season) => seasonList.push({ season, tournaments }));
    out.push({ circuit, seasons: seasonList });
  });
  return out;
}

export default function BrowseTree({ dir, onOpen }: { dir: DirTournament[]; onOpen: (t: DirTournament) => void }) {
  const [gender, setGender] = useState<GenderFilter>(null);
  const [liveOnly, setLiveOnly] = useState(true); // default scope: live & upcoming

  const filtered = useMemo(() => {
    return dir.filter((t) => tournamentMatchesGender(t, gender) && (!liveOnly || isUpcomingOrLive(t)));
  }, [dir, gender, liveOnly]);

  const tree = useMemo(() => buildTree(filtered), [filtered]);

  return (
    <div className="as-fade-in">
      <div className="px-[18px] pt-[8px]">
        <div className="font-[var(--font-mono)] text-[10px] uppercase tracking-[0.12em]" style={{ color: "#cdb98c" }}>
          Browse all
        </div>
        <h2 className="mt-1 font-[var(--font-display)] text-[23px] font-bold tracking-[-0.3px]" style={{ color: C.ink }}>
          Find a tournament
        </h2>
      </div>

      {/* filter chips — gender wired; live & upcoming wired; tier/grade/day deferred to division-browse */}
      <div className="flex flex-wrap gap-[7px] px-[18px] pb-[4px] pt-[12px]">
        {GENDER_CHIPS.map((c) => {
          const on = gender === c.id;
          return (
            <button
              key={c.id}
              type="button"
              aria-pressed={on}
              onClick={() => setGender(on ? null : c.id)}
              className="as-press min-h-[32px] rounded-full px-[12px] font-[var(--font-mono)] text-[10.5px]"
              style={on ? { background: "rgba(246,204,85,.13)", border: "1px solid rgba(246,204,85,.4)", color: C.g3 } : { border: `1px solid ${C.line}`, color: C.dim }}
            >
              {c.label}
            </button>
          );
        })}
        <button
          type="button"
          aria-pressed={liveOnly}
          onClick={() => setLiveOnly((v) => !v)}
          className="as-press min-h-[32px] rounded-full px-[12px] font-[var(--font-mono)] text-[10.5px]"
          style={liveOnly ? { background: "rgba(246,204,85,.13)", border: "1px solid rgba(246,204,85,.4)", color: C.g3 } : { border: `1px solid ${C.line}`, color: C.dim }}
        >
          Live &amp; upcoming
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="mx-[18px] mt-4 rounded-[15px] p-8 text-center" style={{ border: `1px solid ${C.hair}`, background: "linear-gradient(180deg,#151b29,#10141f)" }}>
          <div className="text-[13px] font-semibold" style={{ color: C.ink }}>
            Nothing in this filter
          </div>
          <button type="button" onClick={() => { setGender(null); setLiveOnly(false); }} className="as-press mt-2 text-[12px] underline" style={{ color: C.g3 }}>
            Clear filters
          </button>
        </div>
      ) : (
        <div className="mt-[4px]">
          {tree.map((cg) => (
            <div key={cg.circuit}>
              <div className="flex items-center gap-[8px] px-[18px] pb-[5px] pt-[13px] font-[var(--font-display)] text-[13px] font-bold" style={{ color: C.ink }}>
                <span className="h-[9px] w-[9px] rounded-[3px]" style={{ background: C.grad }} aria-hidden />
                {cg.circuit}
              </div>
              {cg.seasons.map((s) => (
                <div key={s.season}>
                  <div className="px-[18px] pb-[4px] pl-[30px] pt-[4px] font-[var(--font-mono)] text-[9.5px] uppercase tracking-[0.06em]" style={{ color: C.mut }}>
                    {s.season}
                  </div>
                  {s.tournaments.map((t) => {
                    const teamCount = t.divisions.reduce((a, d) => a + (d.team_count ?? 0), 0);
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => onOpen(t)}
                        className="as-press flex w-full items-center gap-[11px] py-[9px] pl-[30px] pr-[18px] text-left"
                        style={{ borderTop: `1px solid ${C.hair}` }}
                      >
                        <span className="self-stretch w-[3px] shrink-0 rounded-[2px]" style={{ background: C.g2 }} aria-hidden />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-semibold" style={{ color: C.ink }}>
                            {t.name}
                          </span>
                          <span className="mt-[2px] block truncate font-[var(--font-mono)] text-[10px]" style={{ color: C.mut }}>
                            {[fmtRange(t.start_date, t.end_date), `${t.divisions.length} division${t.divisions.length === 1 ? "" : "s"}`, teamCount ? `${teamCount} teams` : null].filter(Boolean).join(" · ")}
                          </span>
                        </span>
                        <span className="shrink-0 rounded-[8px] px-[11px] py-[6px] font-[var(--font-mono)] text-[10px]" style={{ border: `1px solid ${C.line}`, color: C.dim }}>
                          Open
                        </span>
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      <div className="mt-5 px-[18px] text-center font-[var(--font-mono)] text-[10px] leading-[1.5]" style={{ color: C.mut }}>
        Filters read structured columns — no name-parsing. Archived seasons stay browsable for records.
      </div>
    </div>
  );
}
