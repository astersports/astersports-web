import { useEffect, useMemo, useState } from "react";
import { Users, X, Trophy } from "lucide-react";
import { getTracked, untrack, TRACKED_EVENT, type TrackedTeam } from "@/lib/aau/trackingStore";

// Screen 03 "My Teams" — foundation. Renders the REAL tracked set (trackingStore),
// grouped by program/club, no placeholder. The live command-center treatment (Realtime
// score hero, glance stats, today's games) is Phase C; this is the honest static base
// that closes the Find → Track → My Teams loop. Empty until the user tracks a team.
export default function MyTeams() {
  const [teams, setTeams] = useState<TrackedTeam[]>([]);

  useEffect(() => {
    const refresh = () => setTeams(getTracked());
    refresh();
    // refresh on same-tab track changes, cross-tab storage writes, and tab focus
    window.addEventListener(TRACKED_EVENT, refresh);
    window.addEventListener("storage", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      window.removeEventListener(TRACKED_EVENT, refresh);
      window.removeEventListener("storage", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, []);

  const groups = useMemo(() => {
    const m = new Map<string, TrackedTeam[]>();
    for (const t of teams) {
      const arr = m.get(t.program) ?? [];
      arr.push(t);
      m.set(t.program, arr);
    }
    return Array.from(m.entries()).sort((a, b) => b[1].length - a[1].length);
  }, [teams]);

  const drop = (key: string) => setTeams(untrack(key));

  return (
    <div className="as-fade-in">
      <div className="flex items-end justify-between px-[18px]">
        <div>
          <h2 className="font-[var(--font-display)] text-[21px] font-bold text-[#f0f3fa]">My Teams</h2>
          <div className="mt-0.5 font-[var(--font-mono)] text-[10.5px] text-[#5f6981]">
            {teams.length} tracked{groups.length > 1 ? ` · ${groups.length} programs` : ""}
          </div>
        </div>
        <Users className="h-5 w-5 text-[#5f6981]" />
      </div>

      {teams.length === 0 && (
        <div className="mx-[18px] mt-4 rounded-[16px] border border-[rgba(255,255,255,0.055)] bg-[linear-gradient(180deg,#151b29,#10141f)] p-8 text-center">
          <Trophy className="mx-auto mb-3 h-7 w-7 text-[#5f6981]" />
          <div className="text-[14px] font-semibold text-[#f0f3fa]">No teams tracked yet</div>
          <div className="mt-1 text-[12px] leading-[1.5] text-[#5f6981]">
            Head to <span className="text-[#9aa4ba]">Find</span>, open a tournament, and track your
            team — it'll live here and follow you to every tournament it plays.
          </div>
        </div>
      )}

      <div className="mt-4 space-y-4">
        {groups.map(([program, list]) => (
          <div
            key={program}
            className="mx-[18px] overflow-hidden rounded-[16px] border border-[rgba(255,255,255,0.055)] bg-[linear-gradient(180deg,#151b29,#10141f)]"
          >
            <div className="flex items-center justify-between border-b border-[rgba(255,255,255,0.055)] px-[15px] py-[11px] font-[var(--font-mono)] text-[10px] uppercase tracking-[0.05em] text-[#cdb98c]">
              <span>{program}</span>
              <span className="text-[#5f6981]">
                {list.length} team{list.length === 1 ? "" : "s"}
              </span>
            </div>
            {list.map((t) => (
              <div key={t.teamKey} className="flex items-center gap-3 border-t border-[rgba(255,255,255,0.055)] px-[15px] py-[12px] first:border-t-0">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13.5px] font-semibold text-[#f0f3fa]">{t.name}</div>
                  <div className="mt-0.5 truncate font-[var(--font-mono)] text-[10.5px] text-[#5f6981]">
                    {t.pool ? `${t.pool} · ` : ""}
                    {t.divisionName} · {t.tournamentName}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => drop(t.teamKey)}
                  aria-label={`Stop tracking ${t.name}`}
                  className="as-press grid h-7 w-7 shrink-0 place-items-center rounded-full border border-[#212939] text-[#5f6981] hover:text-[#ff8a7e]"
                >
                  <X className="h-[13px] w-[13px]" />
                </button>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
