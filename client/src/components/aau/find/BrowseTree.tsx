import { useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import type { DirTournament } from "@/lib/aster";
import { fmtRange } from "@/lib/aau/dates";
import { seasonOf, C } from "./findUi";
import { gradeOrder, expandGrade } from "./gradeBands";
import GradeBandPicker from "./GradeBandPicker";

// Render state 03 "Browse" — collapsible circuit accordions over the directory
// (get_public_tournament_directory) + a real filter bar (gender · year · grade · state · live).
// Filters read STRUCTURED columns only — gender/grade from division columns, year from start_date,
// state from the geocoded A6 venue_state array — never name-parsing (spec §R2/§R3/§7). The circuit
// mis-grouping (Zero Gravity under "Other") is a §2.C DATA fix, NOT a frontend fix — this render
// reads whatever the circuit column says.

type GenderFilter = "F" | "M" | null;
type StateFilter = string | "__unknown__" | null;
type OpenPanel = "year" | "grade" | "state" | null;

function tournamentMatchesGender(t: DirTournament, g: GenderFilter): boolean {
  if (!g) return true;
  return t.divisions.some((d) => d.gender === g);
}

function isUpcomingOrLive(t: DirTournament): boolean {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const end = new Date(`${t.end_date}T00:00:00`);
  return !Number.isNaN(end.getTime()) && end.getTime() >= today.getTime();
}

interface CircuitGroup {
  circuit: string;
  newest: number; // max start_date ms — drives recency sort + default-open
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
    let newest = 0;
    const seasonList: { season: string; tournaments: DirTournament[] }[] = [];
    seasons.forEach((tournaments, season) => {
      tournaments.forEach((t) => {
        const ms = new Date(`${t.start_date}T00:00:00`).getTime();
        if (!Number.isNaN(ms)) newest = Math.max(newest, ms);
      });
      seasonList.push({ season, tournaments });
    });
    seasonList.sort((a, b) => {
      // real years sort desc; the "Undated" null-date sentinel always sinks to the end.
      if (a.season === b.season) return 0;
      if (a.season === "Undated") return 1;
      if (b.season === "Undated") return -1;
      return a.season < b.season ? 1 : -1;
    });
    out.push({ circuit, newest, seasons: seasonList });
  });
  // recency: the circuit holding the newest tournament first; "Other" sinks to the bottom.
  out.sort((a, b) => {
    if (a.circuit === "Other") return 1;
    if (b.circuit === "Other") return -1;
    return b.newest - a.newest;
  });
  return out;
}

// One filter-bar dropdown pill (year / grade / state). Live & gender are direct controls.
function DropPill({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-expanded={on}
      onClick={onClick}
      className="as-press inline-flex min-h-[32px] items-center gap-[6px] rounded-full px-[11px] font-[var(--font-mono)] text-[10.5px]"
      style={on ? { background: "rgba(246,204,85,.13)", border: "1px solid rgba(246,204,85,.4)", color: C.g3 } : { border: `1px solid ${C.line}`, color: C.dim }}
    >
      {label}
      <ChevronDown className="h-[9px] w-[9px]" />
    </button>
  );
}

export default function BrowseTree({ dir, onOpen }: { dir: DirTournament[]; onOpen: (t: DirTournament) => void }) {
  const [gender, setGender] = useState<GenderFilter>(null);
  const [liveOnly, setLiveOnly] = useState(true); // default scope: live & upcoming
  const [year, setYear] = useState<string | null>(null);
  const [grades, setGrades] = useState<Set<string>>(() => new Set());
  const [stateSel, setStateSel] = useState<StateFilter>(null);
  const [panel, setPanel] = useState<OpenPanel>(null);
  const [openOverride, setOpenOverride] = useState<Record<string, boolean>>({});

  // Available filter options — derived from the FULL directory so chips don't churn as you narrow.
  const opts = useMemo(() => {
    const years = new Set<string>();
    const states = new Set<string>();
    const gradeSet = new Set<string>();
    let anyUnknownState = false;
    dir.forEach((t) => {
      const d = new Date(`${t.start_date}T00:00:00`);
      if (!Number.isNaN(d.getTime())) years.add(String(d.getFullYear()));
      if (t.states.length === 0) anyUnknownState = true;
      t.states.forEach((s) => states.add(s));
      // individual grades only — a "5th/6th" division contributes both 5th and 6th chips
      t.divisions.forEach((dv) => expandGrade(dv.grade_label).forEach((g) => gradeSet.add(g)));
    });
    return {
      years: Array.from(years).sort((a, b) => Number(b) - Number(a)),
      states: Array.from(states).sort(),
      grades: Array.from(gradeSet).sort((a, b) => gradeOrder(a) - gradeOrder(b)),
      anyUnknownState,
    };
  }, [dir]);

  const clearAll = () => {
    setGender(null);
    setLiveOnly(false);
    setYear(null);
    setGrades(new Set());
    setStateSel(null);
    setPanel(null);
  };

  const filtered = useMemo(() => {
    return dir.filter((t) => {
      if (!tournamentMatchesGender(t, gender)) return false;
      if (liveOnly && !isUpcomingOrLive(t)) return false;
      if (year) {
        const d = new Date(`${t.start_date}T00:00:00`);
        if (Number.isNaN(d.getTime()) || String(d.getFullYear()) !== year) return false;
      }
      if (grades.size > 0 && !t.divisions.some((dv) => expandGrade(dv.grade_label).some((g) => grades.has(g)))) return false;
      if (stateSel === "__unknown__" && t.states.length !== 0) return false;
      if (stateSel && stateSel !== "__unknown__" && !t.states.includes(stateSel)) return false;
      return true;
    });
  }, [dir, gender, liveOnly, year, grades, stateSel]);

  const tree = useMemo(() => buildTree(filtered), [filtered]);
  const defaultOpen = tree[0]?.circuit;

  const toggleGrade = (g: string) =>
    setGrades((prev) => {
      const next = new Set(prev);
      next.has(g) ? next.delete(g) : next.add(g);
      return next;
    });
  const toggleBand = (bandGrades: string[]) =>
    setGrades((prev) => {
      const next = new Set(prev);
      const allOn = bandGrades.every((g) => next.has(g));
      bandGrades.forEach((g) => (allOn ? next.delete(g) : next.add(g)));
      return next;
    });

  const gradeLabel = grades.size ? `${grades.size} grade${grades.size === 1 ? "" : "s"}` : "Grade";
  const stateLabel = stateSel === "__unknown__" ? "State unknown" : (stateSel ?? "State");

  return (
    <div className="as-fade-in">
      <div className="px-[18px] pt-[8px]">
        <div className="font-[var(--font-mono)] text-[10px] uppercase tracking-[0.12em]" style={{ color: "#8F6708" }}>
          Browse all
        </div>
        <h2 className="mt-1 font-[var(--font-display)] text-[20px] font-bold tracking-[-0.3px]" style={{ color: C.ink }}>
          Find a tournament
        </h2>
      </div>

      {/* filter bar — gender segment + year/grade/state dropdowns + live toggle */}
      <div className="flex flex-wrap gap-[7px] px-[18px] pb-[4px] pt-[12px]">
        <div className="inline-flex overflow-hidden rounded-full" style={{ border: `1px solid ${C.line}` }}>
          {([
            { id: null, label: "All" },
            { id: "F", label: "Girls" },
            { id: "M", label: "Boys" },
          ] as const).map((seg) => {
            const on = gender === seg.id;
            return (
              <button
                key={seg.label}
                type="button"
                aria-pressed={on}
                onClick={() => setGender(seg.id)}
                className="as-press min-h-[32px] px-[11px] font-[var(--font-mono)] text-[10.5px]"
                style={on ? { background: C.grad, color: "#1a1206", fontWeight: 700 } : { color: C.dim }}
              >
                {seg.label}
              </button>
            );
          })}
        </div>
        {opts.years.length > 0 && (
          <DropPill label={year ?? "Year"} on={panel === "year" || !!year} onClick={() => setPanel(panel === "year" ? null : "year")} />
        )}
        {opts.grades.length > 0 && (
          <DropPill label={gradeLabel} on={panel === "grade" || grades.size > 0} onClick={() => setPanel(panel === "grade" ? null : "grade")} />
        )}
        {(opts.states.length > 0 || opts.anyUnknownState) && (
          <DropPill label={stateLabel} on={panel === "state" || !!stateSel} onClick={() => setPanel(panel === "state" ? null : "state")} />
        )}
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

      {/* expandable filter panel (one open at a time) */}
      {panel === "year" && (
        <div className="flex flex-wrap gap-[7px] px-[18px] pb-[4px] pt-[6px]">
          {opts.years.map((y) => (
            <button
              key={y}
              type="button"
              aria-pressed={year === y}
              onClick={() => setYear(year === y ? null : y)}
              className="as-press min-h-[32px] rounded-full px-[12px] font-[var(--font-mono)] text-[10.5px]"
              style={year === y ? { background: C.grad, color: "#1a1206", fontWeight: 700 } : { border: `1px solid ${C.line}`, color: C.dim }}
            >
              {y}
            </button>
          ))}
        </div>
      )}
      {panel === "grade" && <GradeBandPicker available={opts.grades} selected={grades} onToggleGrade={toggleGrade} onToggleBand={toggleBand} />}
      {panel === "state" && (
        <div className="flex flex-wrap gap-[7px] px-[18px] pb-[4px] pt-[6px]">
          {opts.states.map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={stateSel === s}
              onClick={() => setStateSel(stateSel === s ? null : s)}
              className="as-press min-h-[32px] rounded-full px-[12px] font-[var(--font-mono)] text-[10.5px]"
              style={stateSel === s ? { background: C.grad, color: "#1a1206", fontWeight: 700 } : { border: `1px solid ${C.line}`, color: C.dim }}
            >
              {s}
            </button>
          ))}
          {opts.anyUnknownState && (
            <button
              type="button"
              aria-pressed={stateSel === "__unknown__"}
              onClick={() => setStateSel(stateSel === "__unknown__" ? null : "__unknown__")}
              className="as-press min-h-[32px] rounded-full px-[12px] font-[var(--font-mono)] text-[10.5px]"
              style={stateSel === "__unknown__" ? { background: "rgba(246,204,85,.13)", border: "1px solid rgba(246,204,85,.4)", color: C.g3 } : { border: `1px solid ${C.line}`, color: C.mut }}
            >
              State unknown
            </button>
          )}
        </div>
      )}

      {/* live result count — so a narrowing filter shows how many tournaments remain */}
      <div className="px-[18px] pt-[8px] font-[var(--font-mono)] text-[10px]" style={{ color: C.mut }} aria-live="polite">
        {filtered.length} tournament{filtered.length === 1 ? "" : "s"}
      </div>

      {filtered.length === 0 ? (
        <div className="mx-[18px] mt-4 rounded-[15px] p-8 text-center" style={{ border: `1px solid ${C.hair}`, background: "linear-gradient(180deg,#F9FAFB,#FFFFFF)" }}>
          <div className="text-[13px] font-semibold" style={{ color: C.ink }}>
            Nothing in this filter
          </div>
          <button type="button" onClick={clearAll} className="as-press mt-2 text-[12px] underline" style={{ color: C.g3 }}>
            Clear filters
          </button>
        </div>
      ) : (
        <div className="mt-[6px]">
          {tree.map((cg) => {
            const isOpen = openOverride[cg.circuit] ?? cg.circuit === defaultOpen;
            const count = cg.seasons.reduce((a, s) => a + s.tournaments.length, 0);
            const dot = cg.circuit === "Other" ? C.mut : undefined;
            return (
              <div key={cg.circuit} style={{ borderTop: `1px solid ${C.hair}` }}>
                <button
                  type="button"
                  aria-expanded={isOpen}
                  onClick={() => setOpenOverride((p) => ({ ...p, [cg.circuit]: !isOpen }))}
                  className="as-press flex w-full items-center gap-[10px] px-[18px] py-[13px] text-left"
                  style={{ opacity: isOpen ? 1 : 0.72 }}
                >
                  <ChevronDown className="h-[11px] w-[11px] transition-transform" style={{ color: isOpen ? C.g3 : C.mut, transform: isOpen ? "none" : "rotate(-90deg)" }} />
                  <span className="h-[9px] w-[9px] rounded-[3px]" style={dot ? { background: dot } : { background: C.grad }} aria-hidden />
                  <span className="flex-1 font-[var(--font-display)] text-[13px] font-bold" style={{ color: C.ink }}>
                    {cg.circuit}
                  </span>
                  <span className="font-[var(--font-mono)] text-[10px]" style={{ color: C.mut }}>
                    {count} event{count === 1 ? "" : "s"}
                  </span>
                </button>
                {isOpen &&
                  cg.seasons.map((s) => (
                    <div key={s.season}>
                      <div className="px-[18px] pb-[4px] pl-[32px] pt-[2px] font-[var(--font-mono)] text-[9.5px] uppercase tracking-[0.06em]" style={{ color: C.mut }}>
                        {s.season}
                      </div>
                      {s.tournaments.map((t) => {
                        const teamCount = t.divisions.reduce((a, d) => a + (d.team_count ?? 0), 0);
                        return (
                          <button
                            key={t.id}
                            type="button"
                            onClick={() => onOpen(t)}
                            aria-label={`Open ${t.name}`}
                            className="as-press flex min-h-[44px] w-full items-center gap-[11px] py-[9px] pl-[32px] pr-[18px] text-left"
                            style={{ borderTop: `1px solid ${C.hair}` }}
                          >
                            <span className="self-stretch w-[3px] shrink-0 rounded-[2px]" style={{ background: C.g2 }} aria-hidden />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-[13px] font-semibold" style={{ color: C.ink }}>
                                {t.name}
                              </span>
                              <span className="mt-[2px] block truncate font-[var(--font-mono)] text-[10px]" style={{ color: C.mut }}>
                                {[fmtRange(t.start_date, t.end_date), t.states.length ? t.states.join("/") : null, `${t.divisions.length} div`, teamCount ? `${teamCount} teams` : null].filter(Boolean).join(" · ")}
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
            );
          })}
        </div>
      )}

      <div className="mt-5 px-[18px] text-center font-[var(--font-mono)] text-[10px] leading-[1.5]" style={{ color: C.mut }}>
        Filters read structured columns — no name-parsing. Past seasons collapse; tap to browse for records.
      </div>
    </div>
  );
}
