import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronDown, Search, Check, Plus, Trophy } from "lucide-react";
import { getTournamentTeams, type TournamentTeams } from "@/lib/aster";
import { parseDivisionMeta, parseProgram, type Gender } from "@/lib/aau/teamMeta";
import { track } from "@/lib/aau/trackingStore";
import GradeBandPicker from "./find/GradeBandPicker";
import { expandGrade, gradeOrder } from "./find/gradeBands";

// Screen 02 "Track one or many" — best-in-class render 02, ratified search-first.
// A tournament → its teams across every division, with gender + grade as ASSIST chips
// (narrow, never gate), club-grouped with a "+ All <program>" bulk-track, multi-select,
// and a sticky "Track N selected". Binds get_public_tournament_teams — real pools +
// records, no placeholder. gender/grade derived from the division name (teamMeta).
interface Props {
  tournamentId: string;
  tournamentName: string;
  onBack: () => void;
  onTracked: (count: number) => void;
}

interface FlatTeam {
  selKey: string; // unique per division+team
  teamKey: string;
  name: string;
  program: string;
  pool: string | null;
  wins: number;
  losses: number;
  gender: Gender | null;
  grade: string | null;
  divisionId: string;
  divisionName: string;
}

export default function TrackTeams({ tournamentId, tournamentName, onBack, onTracked }: Props) {
  const [data, setData] = useState<TournamentTeams | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [q, setQ] = useState("");
  const [gender, setGender] = useState<Gender | "All">("All");
  const [gradeSel, setGradeSel] = useState<Set<string>>(new Set()); // individual grades (split-expanded)
  const [gradeOpen, setGradeOpen] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());

  useEffect(() => {
    let live = true;
    getTournamentTeams(tournamentId)
      .then((d) => live && setData(d))
      .catch((e) => live && setError(e as Error));
    return () => {
      live = false;
    };
  }, [tournamentId]);

  // flatten every division's teams with derived gender/grade
  const flat = useMemo<FlatTeam[]>(() => {
    if (!data) return [];
    const out: FlatTeam[] = [];
    for (const d of data.divisions) {
      const meta = parseDivisionMeta(d.name);
      const g = (d.gender as Gender) || meta.gender;
      const gr = d.grade_label || meta.grade;
      for (const t of d.teams) {
        out.push({
          selKey: `${d.id}:${t.id}`,
          teamKey: t.id,
          name: t.name,
          program: parseProgram(t.name),
          pool: t.pool,
          wins: t.wins,
          losses: t.losses,
          gender: g,
          grade: gr,
          divisionId: d.id,
          divisionName: d.name,
        });
      }
    }
    return out;
  }, [data]);

  const genders = useMemo(() => {
    const s = new Set<Gender>();
    flat.forEach((t) => t.gender && s.add(t.gender));
    return Array.from(s);
  }, [flat]);
  // individual grades present — a "5th/6th" division contributes both 5th and 6th (operator-directed,
  // matches BrowseTree). Feeds the shared age-band picker.
  const availGrades = useMemo(() => {
    const s = new Set<string>();
    flat.forEach((t) => expandGrade(t.grade).forEach((g) => s.add(g)));
    return Array.from(s).sort((a, b) => gradeOrder(a) - gradeOrder(b));
  }, [flat]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return flat.filter(
      (t) =>
        (gender === "All" || t.gender === gender) &&
        (gradeSel.size === 0 || expandGrade(t.grade).some((g) => gradeSel.has(g))) &&
        (!term || t.name.toLowerCase().includes(term) || t.program.toLowerCase().includes(term)),
    );
  }, [flat, q, gender, gradeSel]);

  const toggleGrade = (g: string) =>
    setGradeSel((p) => {
      const n = new Set(p);
      n.has(g) ? n.delete(g) : n.add(g);
      return n;
    });
  const toggleBand = (bandGrades: string[]) =>
    setGradeSel((p) => {
      const n = new Set(p);
      const allOn = bandGrades.every((g) => n.has(g));
      bandGrades.forEach((g) => (allOn ? n.delete(g) : n.add(g)));
      return n;
    });

  // group filtered teams by program (club), program order by first appearance
  const groups = useMemo(() => {
    const m = new Map<string, FlatTeam[]>();
    for (const t of filtered) {
      const arr = m.get(t.program) ?? [];
      arr.push(t);
      m.set(t.program, arr);
    }
    return Array.from(m.entries());
  }, [filtered]);

  const toggle = (k: string) =>
    setSel((p) => {
      const n = new Set(p);
      n.has(k) ? n.delete(k) : n.add(k);
      return n;
    });
  // Toggle the whole program group: if every team in the view is already selected, clear them
  // all (Frank: "unselect all is a good option"); otherwise select them all.
  const toggleAll = (teams: FlatTeam[]) =>
    setSel((p) => {
      const n = new Set(p);
      const allOn = teams.every((t) => n.has(t.selKey));
      teams.forEach((t) => (allOn ? n.delete(t.selKey) : n.add(t.selKey)));
      return n;
    });

  const doTrack = () => {
    const chosen = flat.filter((t) => sel.has(t.selKey));
    if (!chosen.length) return;
    track(
      chosen.map((t) => ({
        teamKey: t.teamKey,
        name: t.name,
        pool: t.pool,
        tournamentId,
        tournamentName,
        divisionId: t.divisionId,
        divisionName: t.divisionName,
      })),
    );
    onTracked(chosen.length);
  };

  // extra bottom room when the sticky Track bar is up (incl. iOS safe area), so the
  // last rows stay tappable
  const bottomPad = sel.size > 0 ? "pb-[calc(176px+env(safe-area-inset-bottom))]" : "pb-24";
  return (
    <div className={`as-fade-in ${bottomPad}`}>
      <button
        type="button"
        onClick={onBack}
        className="mb-2 flex items-center gap-1 font-[var(--font-mono)] text-[11px] text-[#4A5568]"
      >
        <ChevronLeft className="h-4 w-4" /> Find
      </button>

      <div className="px-[18px]">
        <div className="font-[var(--font-mono)] text-[10px] uppercase tracking-[0.12em] text-[#8F6708]">
          {tournamentName}
        </div>
        <h2 className="mt-1 font-[var(--font-display)] text-[23px] font-bold tracking-[-0.3px] text-[#1A1D23]">
          Track teams
        </h2>
      </div>

      {/* search */}
      <div className="mx-[18px] mt-2 flex items-center gap-[11px] rounded-[15px] border border-[#E2E8F0] bg-[#F9FAFB] px-[15px] py-[13px] shadow-[inset_0_1px_0_rgba(0,0,0,0.04)]">
        <Search className="h-[18px] w-[18px] shrink-0 text-[#6B7280]" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search a team or club"
          aria-label="Search teams or clubs"
          className="w-full bg-transparent text-[13.5px] text-[#1A1D23] placeholder-[#6B7280] outline-none"
        />
      </div>

      {/* gender chips + grade age-band picker (assist filters — narrow, never gate) */}
      {(genders.length > 1 || availGrades.length > 0) && (
        <div className="mt-3 space-y-2">
          {genders.length > 1 && (
            <ChipRow
              items={["All", ...genders]}
              active={gender}
              onPick={(v) => setGender(v as Gender | "All")}
            />
          )}
          {availGrades.length > 0 && (
            <div className="px-[18px]">
              <button
                type="button"
                aria-expanded={gradeOpen}
                onClick={() => setGradeOpen((o) => !o)}
                className="as-press inline-flex min-h-[32px] items-center gap-[6px] rounded-full px-[12px] font-[var(--font-mono)] text-[11px]"
                style={
                  gradeOpen || gradeSel.size > 0
                    ? { background: "rgba(246,204,85,.13)", border: "1px solid rgba(246,204,85,.4)", color: "#8F6708" }
                    : { border: "1px solid #E2E8F0", color: "#4A5568" }
                }
              >
                {gradeSel.size ? `${gradeSel.size} grade${gradeSel.size === 1 ? "" : "s"}` : "Grade"}
                <ChevronDown className="h-[10px] w-[10px]" />
              </button>
            </div>
          )}
          {gradeOpen && availGrades.length > 0 && (
            <GradeBandPicker available={availGrades} selected={gradeSel} onToggleGrade={toggleGrade} onToggleBand={toggleBand} />
          )}
        </div>
      )}

      {/* states */}
      {error && (
        <div className="mx-[18px] mt-4 rounded-[15px] border border-[rgba(0,0,0,0.06)] bg-[linear-gradient(180deg,#F9FAFB,#FFFFFF)] p-6 text-center text-[12px] text-[#6B7280]">
          Couldn't load this tournament's teams. Try again in a moment.
        </div>
      )}
      {!data && !error && (
        <div className="mt-4 space-y-[9px] px-[18px]">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-[58px] animate-pulse rounded-[14px] border border-[rgba(0,0,0,0.06)] bg-[#FFFFFF]/60" />
          ))}
        </div>
      )}
      {data && filtered.length === 0 && (
        <div className="mx-[18px] mt-4 rounded-[15px] border border-[rgba(0,0,0,0.06)] bg-[linear-gradient(180deg,#F9FAFB,#FFFFFF)] p-8 text-center">
          <Trophy className="mx-auto mb-3 h-7 w-7 text-[#6B7280]" />
          <div className="text-[14px] font-semibold text-[#1A1D23]">No teams match</div>
          <div className="mt-1 text-[12px] text-[#6B7280]">Clear the filters or try a different search.</div>
        </div>
      )}

      {/* grouped teams */}
      <div className="mt-3">
        {groups.map(([program, teams]) => {
          const nested = teams.length > 1; // multi-team club → pinned header + indented rows
          const allOn = nested && teams.every((t) => sel.has(t.selKey));
          return (
          <div key={program} className="mt-3 first:mt-0">
            {nested && (
                  <button
                    type="button"
                    onClick={() => toggleAll(teams)}
                    aria-pressed={allOn}
                    className="as-press mx-[18px] flex w-[calc(100%-36px)] items-center justify-between rounded-[14px] border border-[#E2C98A] bg-[linear-gradient(180deg,rgba(246,204,85,0.08),rgba(246,204,85,0.02))] px-[15px] py-[12px] text-left"
                  >
                    <span>
                      <span className="text-[13px] font-semibold text-[#1A1D23]">
                        {allOn ? "Unselect all of " : "Track all of "}
                        {program}
                      </span>
                      <small className="mt-0.5 block font-[var(--font-mono)] text-[10px] text-[#6B7280]">
                        {teams.length} teams in this view
                      </small>
                    </span>
                    <span className="font-[var(--font-mono)] text-[11px] text-[#8F6708]">{allOn ? "Clear" : "+ All"}</span>
                  </button>
            )}
            {teams.map((t) => {
              const on = sel.has(t.selKey);
              return (
                <button
                  key={t.selKey}
                  type="button"
                  onClick={() => toggle(t.selKey)}
                  aria-pressed={on}
                  className={`as-press mt-[9px] flex items-center gap-[13px] rounded-[14px] border px-[15px] py-[13px] text-left ${
                    nested ? "ml-[30px] mr-[18px] w-[calc(100%-48px)] border-l-[2px] border-l-[#E2C98A]" : "mx-[18px] w-[calc(100%-36px)]"
                  } ${
                    on
                      ? "border-[rgba(246,204,85,0.4)] bg-[linear-gradient(180deg,rgba(246,204,85,0.07),rgba(246,204,85,0.01))]"
                      : "border-[rgba(0,0,0,0.06)] bg-[linear-gradient(180deg,#F9FAFB,#FFFFFF)]"
                  }`}
                >
                  <span
                    className={`grid h-[22px] w-[22px] shrink-0 place-items-center rounded-[7px] border ${
                      on ? "border-transparent bg-[linear-gradient(100deg,#E0631C,#E8902A,#F6CC55,#FBD56B)]" : "border-[#E2E8F0]"
                    }`}
                  >
                    {on && <Check className="h-[13px] w-[13px] text-[#1a1206]" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-semibold text-[#1A1D23]">{t.name}</span>
                    <small className="mt-0.5 block font-[var(--font-mono)] text-[10px] text-[#6B7280]">
                      {[[t.gender, t.grade].filter(Boolean).join(" "), t.pool, `${t.wins}–${t.losses}`]
                        .filter(Boolean)
                        .join(" · ")}
                    </small>
                  </span>
                </button>
              );
            })}
          </div>
          );
        })}
      </div>

      {/* sticky track CTA — sits above the 64px nav incl. iOS safe area */}
      {sel.size > 0 && (
        <div className="fixed inset-x-0 bottom-[calc(64px+env(safe-area-inset-bottom))] z-30 bg-[linear-gradient(transparent,#F7F8FA_40%)] px-[18px] pb-3 pt-5">
          <button
            type="button"
            onClick={doTrack}
            className="as-press flex w-full items-center justify-center gap-2 rounded-[14px] bg-[linear-gradient(100deg,#E0631C,#E8902A,#F6CC55,#FBD56B)] py-[15px] font-[var(--font-display)] text-[14.5px] font-semibold text-[#1a1206] shadow-[0_12px_30px_-12px_rgba(224,99,28,0.6)]"
          >
            <Plus className="h-4 w-4" /> Track {sel.size} selected team{sel.size === 1 ? "" : "s"}
          </button>
        </div>
      )}
    </div>
  );
}

function ChipRow({ items, active, onPick }: { items: string[]; active: string; onPick: (v: string) => void }) {
  return (
    <div className="flex gap-2 overflow-x-auto px-[18px] pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {items.map((it) => {
        const on = active === it;
        return (
          <button
            key={it}
            type="button"
            onClick={() => onPick(it)}
            className={`shrink-0 rounded-full border px-[15px] py-[7px] text-[12.5px] font-semibold ${
              on
                ? "border-transparent bg-[linear-gradient(100deg,#E0631C,#E8902A,#F6CC55,#FBD56B)] text-[#1a1206]"
                : "border-[#E2E8F0] bg-[#F9FAFB] text-[#4A5568]"
            }`}
          >
            {it}
          </button>
        );
      })}
    </div>
  );
}
