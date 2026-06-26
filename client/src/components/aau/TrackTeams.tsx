import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, Search, Check, Plus, Trophy } from "lucide-react";
import { getTournamentTeams, type TournamentTeams } from "@/lib/aster";
import { parseDivisionMeta, parseProgram, type Gender } from "@/lib/aau/teamMeta";
import { track } from "@/lib/aau/trackingStore";

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

const GRADE_ORDER = (g: string) =>
  g === "High School" ? 99 : parseInt(g, 10) || (g.endsWith("U") ? parseInt(g, 10) : 50);

export default function TrackTeams({ tournamentId, tournamentName, onBack, onTracked }: Props) {
  const [data, setData] = useState<TournamentTeams | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [q, setQ] = useState("");
  const [gender, setGender] = useState<Gender | "All">("All");
  const [grade, setGrade] = useState<string>("All");
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
  const grades = useMemo(() => {
    const s = new Set<string>();
    flat.forEach((t) => t.grade && s.add(t.grade));
    return Array.from(s).sort((a, b) => GRADE_ORDER(a) - GRADE_ORDER(b));
  }, [flat]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return flat.filter(
      (t) =>
        (gender === "All" || t.gender === gender) &&
        (grade === "All" || t.grade === grade) &&
        (!term || t.name.toLowerCase().includes(term) || t.program.toLowerCase().includes(term)),
    );
  }, [flat, q, gender, grade]);

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
  const addAll = (teams: FlatTeam[]) =>
    setSel((p) => {
      const n = new Set(p);
      teams.forEach((t) => n.add(t.selKey));
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

  return (
    <div className="as-fade-in pb-24">
      <button
        type="button"
        onClick={onBack}
        className="mb-2 flex items-center gap-1 font-[var(--font-mono)] text-[11px] text-[#9aa4ba]"
      >
        <ChevronLeft className="h-4 w-4" /> Find
      </button>

      <div className="px-[18px]">
        <div className="font-[var(--font-mono)] text-[10px] uppercase tracking-[0.12em] text-[#cdb98c]">
          {tournamentName}
        </div>
        <h2 className="mt-1 font-[var(--font-display)] text-[23px] font-bold tracking-[-0.3px] text-[#f0f3fa]">
          Track teams
        </h2>
      </div>

      {/* search */}
      <div className="mx-[18px] mt-2 flex items-center gap-[11px] rounded-[15px] border border-[#212939] bg-[#151b29] px-[15px] py-[13px] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
        <Search className="h-[18px] w-[18px] shrink-0 text-[#5f6981]" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search a team or club"
          aria-label="Search teams or clubs"
          className="w-full bg-transparent text-[13.5px] text-[#f0f3fa] placeholder-[#5f6981] outline-none"
        />
      </div>

      {/* gender + grade assist-chips (narrow, never gate) */}
      {(genders.length > 1 || grades.length > 1) && (
        <div className="mt-3 space-y-2">
          {genders.length > 1 && (
            <ChipRow
              items={["All", ...genders]}
              active={gender}
              onPick={(v) => setGender(v as Gender | "All")}
            />
          )}
          {grades.length > 1 && (
            <ChipRow items={["All", ...grades]} active={grade} onPick={setGrade} />
          )}
        </div>
      )}

      {/* states */}
      {error && (
        <div className="mx-[18px] mt-4 rounded-[15px] border border-[rgba(255,255,255,0.055)] bg-[linear-gradient(180deg,#151b29,#10141f)] p-6 text-center text-[12px] text-[#5f6981]">
          Couldn't load this tournament's teams. Try again in a moment.
        </div>
      )}
      {!data && !error && (
        <div className="mt-4 space-y-[9px] px-[18px]">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-[58px] animate-pulse rounded-[14px] border border-[rgba(255,255,255,0.055)] bg-[#10141f]/60" />
          ))}
        </div>
      )}
      {data && filtered.length === 0 && (
        <div className="mx-[18px] mt-4 rounded-[15px] border border-[rgba(255,255,255,0.055)] bg-[linear-gradient(180deg,#151b29,#10141f)] p-8 text-center">
          <Trophy className="mx-auto mb-3 h-7 w-7 text-[#5f6981]" />
          <div className="text-[14px] font-semibold text-[#f0f3fa]">No teams match</div>
          <div className="mt-1 text-[12px] text-[#5f6981]">Clear the filters or try a different search.</div>
        </div>
      )}

      {/* grouped teams */}
      <div className="mt-3">
        {groups.map(([program, teams]) => (
          <div key={program} className="mt-3 first:mt-0">
            {teams.length > 1 && (
              <button
                type="button"
                onClick={() => addAll(teams)}
                className="as-press mx-[18px] flex w-[calc(100%-36px)] items-center justify-between rounded-[14px] border border-[#5a4a25] bg-[linear-gradient(180deg,rgba(246,204,85,0.08),rgba(246,204,85,0.02))] px-[15px] py-[12px] text-left"
              >
                <span>
                  <span className="text-[13px] font-semibold text-[#f0f3fa]">Track all of {program}</span>
                  <small className="mt-0.5 block font-[var(--font-mono)] text-[10px] text-[#5f6981]">
                    {teams.length} teams in this view
                  </small>
                </span>
                <span className="font-[var(--font-mono)] text-[11px] text-[#F6CC55]">+ All</span>
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
                  className={`as-press mx-[18px] mt-[9px] flex w-[calc(100%-36px)] items-center gap-[13px] rounded-[14px] border px-[15px] py-[13px] text-left ${
                    on
                      ? "border-[rgba(246,204,85,0.4)] bg-[linear-gradient(180deg,rgba(246,204,85,0.07),rgba(246,204,85,0.01))]"
                      : "border-[rgba(255,255,255,0.055)] bg-[linear-gradient(180deg,#151b29,#10141f)]"
                  }`}
                >
                  <span
                    className={`grid h-[22px] w-[22px] shrink-0 place-items-center rounded-[7px] border ${
                      on ? "border-transparent bg-[linear-gradient(100deg,#E0631C,#E8902A,#F6CC55,#FBD56B)]" : "border-[#212939]"
                    }`}
                  >
                    {on && <Check className="h-[13px] w-[13px] text-[#1a1206]" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-semibold text-[#f0f3fa]">{t.name}</span>
                    <small className="mt-0.5 block font-[var(--font-mono)] text-[10px] text-[#5f6981]">
                      {t.pool ? `${t.pool} · ` : ""}
                      {t.wins}–{t.losses}
                      {t.grade ? ` · ${t.grade}` : ""}
                    </small>
                  </span>
                </button>
              );
            })}
          </div>
        ))}
      </div>

      {/* sticky track CTA */}
      {sel.size > 0 && (
        <div className="fixed inset-x-0 bottom-[64px] z-30 bg-[linear-gradient(transparent,#070a11_40%)] px-[18px] pb-3 pt-4">
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
                : "border-[#212939] bg-[#151b29] text-[#9aa4ba]"
            }`}
          >
            {it}
          </button>
        );
      })}
    </div>
  );
}
