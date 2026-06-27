import { useEffect, useMemo, useState } from "react";
import { Users, X, Trophy, ChevronRight } from "lucide-react";
import { getTracked, untrack, TRACKED_EVENT, type TrackedTeam } from "@/lib/aau/trackingStore";
import { getTrackedTeamSchedule, getTournamentStandings, type TeamGame } from "@/lib/aster";
import { buildMyTeamsModel, type MyTeamsModel } from "@/lib/aau/myTeamsModel";
import { predictBracket } from "@/lib/standings/predictBracket";
import { effectiveRatings } from "@/lib/aau/gradePrior";
import ConflictRadar from "./ConflictRadar";
import NextGame from "./NextGame";
import TeamDetail from "./TeamDetail";
import HomeGatedSections from "./HomeGatedSections";

// Screen 03 "My Teams · command center" — render-faithful. Header + "updating live" (only
// when a tracked team is in progress), a live score hero, three glance stats (to-advance %
// from the predictor · live now · today), and tracked teams grouped by program with each
// team's record + today's pill. All real: records from FINAL games, live/today from status
// + start times, odds enumerated by the predictor. No fabrication — the hero exists only
// when a game is in progress; absent data degrades quietly.

const norm = (s: string) => s.trim().toLowerCase();

export default function MyTeams() {
  const [teams, setTeams] = useState<TrackedTeam[]>([]);
  const [games, setGames] = useState<TeamGame[]>([]);
  const [odds, setOdds] = useState<Record<string, number>>({}); // teamKey → "to advance" %
  const [selected, setSelected] = useState<string | null>(null); // open a team's detail

  useEffect(() => {
    const refresh = () => setTeams(getTracked());
    refresh();
    window.addEventListener(TRACKED_EVENT, refresh);
    window.addEventListener("storage", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      window.removeEventListener(TRACKED_EVENT, refresh);
      window.removeEventListener("storage", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, []);

  useEffect(() => {
    const ids = teams.map((t) => t.teamKey);
    if (!ids.length) { setGames([]); return; }
    let live = true;
    getTrackedTeamSchedule(ids).then((g) => live && setGames(g)).catch(() => live && setGames([]));
    return () => { live = false; };
  }, [teams]);

  const model: MyTeamsModel = useMemo(() => buildMyTeamsModel(teams, games), [teams, games]);
  const programLabel = useMemo(() => {
    const list = Array.from(new Set(teams.map((t) => t.program).filter(Boolean)));
    return list.length === 1 ? list[0] : list.length > 1 ? `${list.length} programs` : "";
  }, [teams]);

  // Featured team for the "to advance" stat: the live team if one is in progress, else the
  // team playing soonest, else the first tracked. Always ONE definite team — never a blend
  // of the tracked set (the % belongs to a single team's division bracket).
  const nextUpKey = useMemo(() => {
    const up = games
      .filter((g) => g.status !== "final" && g.startAt)
      .sort((a, b) => +new Date(a.startAt!) - +new Date(b.startAt!));
    return up[0]?.trackedTeamId ?? null;
  }, [games]);
  const featured = useMemo(() => {
    const key = model.hero?.teamKey ?? nextUpKey ?? teams[0]?.teamKey ?? null;
    return key ? teams.find((t) => t.teamKey === key) ?? null : null;
  }, [model.hero, nextUpKey, teams]);

  // "to advance" odds for EVERY tracked team (not just the featured one) — the predictor
  // over each team's division standings, weighted by strength + grade. Each distinct
  // division is fetched once; teams sharing it reuse the bundle. Gate out "even" (no signal)
  // so a row shows a number only when there's a real basis. Keyed by teamKey → every row
  // shows its own odds, so two teams with different odds both appear (not just one).
  useEffect(() => {
    let live = true;
    const byDiv = new Map<string, TrackedTeam[]>();
    for (const t of teams) {
      if (!t.divisionId) continue;
      const arr = byDiv.get(t.divisionId) ?? [];
      arr.push(t);
      byDiv.set(t.divisionId, arr);
    }
    if (!byDiv.size) { setOdds({}); return; }
    Promise.all(
      Array.from(byDiv.entries()).map(async ([divId, members]): Promise<[string, number][]> => {
        const b = await getTournamentStandings(divId).catch(() => null);
        if (!b) return [];
        const eff = effectiveRatings(b.teams, b.division.name);
        const out: [string, number][] = [];
        for (const t of members) {
          const me = b.teams.find((x) => norm(x.name) === norm(t.name));
          if (!me) continue;
          const p = predictBracket({
            teams: b.teams, games: b.games, remaining: b.remaining,
            rules: b.rules, advanceCount: b.division.advance_count, focusId: me.id, eff,
          });
          if (p.available && p.basis !== "even" && p.oddsPct != null) out.push([t.teamKey, p.oddsPct]);
        }
        return out;
      }),
    ).then((all) => {
      if (!live) return;
      const map: Record<string, number> = {};
      for (const arr of all) for (const [k, v] of arr) map[k] = v;
      setOdds(map);
    });
    return () => { live = false; };
  }, [teams]);

  const drop = (key: string) => setTeams(untrack(key));
  const liveActive = model.glance.liveNow > 0;
  const featuredPct = featured ? odds[featured.teamKey] : undefined; // headline = featured team

  // team detail drill-down (game-by-game schedule + results + directions)
  const sel = selected ? teams.find((t) => t.teamKey === selected) : null;
  if (sel) return <TeamDetail team={sel} games={games} onBack={() => setSelected(null)} />;

  return (
    <div className="as-fade-in pb-6">
      {/* page header */}
      <div className="flex items-center justify-between px-[18px] pb-1 pt-[14px]">
        <div>
          <h2 className="font-[var(--font-display)] text-[21px] font-bold text-[#f0f3fa]">Home</h2>
          <div className="mt-0.5 font-[var(--font-mono)] text-[10.5px] text-[#5f6981]">
            {teams.length ? `${teams.length} tracked${programLabel ? ` · ${programLabel}` : ""}` : "your weekend, handled"}
          </div>
        </div>
        {liveActive ? (
          <span className="flex items-center gap-1.5 rounded-full border border-[rgba(52,224,164,0.3)] bg-[rgba(52,224,164,0.05)] px-[11px] py-[5px] font-[var(--font-mono)] text-[9.5px] text-[#34e0a4]">
            <span className="h-2 w-2 animate-pulse rounded-full bg-[#34e0a4] shadow-[0_0_10px_rgba(52,224,164,0.7)]" /> updating live
          </span>
        ) : (
          <Users className="h-5 w-5 text-[#5f6981]" />
        )}
      </div>

      {/* live score hero — only when a tracked team is in progress */}
      {model.hero && (
        <div className="mx-[18px] mt-[10px] overflow-hidden rounded-[18px] border border-[rgba(52,224,164,0.28)] bg-[radial-gradient(300px_120px_at_20%_0%,rgba(52,224,164,0.12),transparent),linear-gradient(180deg,#1b2233,#10141f)] shadow-[0_16px_40px_-24px_rgba(52,224,164,0.4)]">
          <div className="flex items-center justify-between border-b border-[rgba(255,255,255,0.055)] px-[15px] py-[11px] font-[var(--font-mono)] text-[10px] text-[#34e0a4]">
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 animate-pulse rounded-full bg-[#34e0a4]" /> LIVE{model.hero.pool ? ` · ${model.hero.pool}` : ""}</span>
            <span>{model.hero.division}</span>
          </div>
          <div className="flex items-center justify-between px-4 pb-2 pt-[14px]">
            <div className="w-[86px] shrink-0">
              <div className="font-[var(--font-display)] text-[15px] font-semibold leading-[1.12] text-[#bfe7d8]">{model.hero.myName}</div>
            </div>
            <div className={`font-[var(--font-mono)] text-[32px] font-bold tracking-[-1px] ${model.hero.myWinning ? "text-[#F6CC55]" : "text-[#f0f3fa]"}`}>{model.hero.myScore}</div>
            <div className="px-[9px] font-[var(--font-mono)] text-[11px] text-[#454e63]">–</div>
            <div className="font-[var(--font-mono)] text-[32px] font-bold tracking-[-1px] text-[#f0f3fa]">{model.hero.oppScore}</div>
            <div className="w-[86px] shrink-0 text-right">
              <div className="font-[var(--font-display)] text-[15px] font-semibold leading-[1.12] text-[#f0f3fa]">{model.hero.oppName}</div>
            </div>
          </div>
          <div className="mx-4 mb-[14px] h-1 overflow-hidden rounded-[2px] bg-[rgba(255,255,255,0.06)]">
            <i className="block h-full rounded-[2px] bg-[linear-gradient(90deg,#E8902A,#F6CC55)]" style={{ width: `${heroBar(model.hero.myScore, model.hero.oppScore)}%` }} />
          </div>
        </div>
      )}

      {/* glance stats */}
      {teams.length > 0 && (
        <>
          <div className="flex gap-[10px] px-[18px] pt-3">
            <GlanceCard value={featuredPct == null ? "—" : `${featuredPct}%`} label="to advance" grad />
            <GlanceCard value={String(model.glance.liveNow)} label="live now" />
            <GlanceCard value={String(model.glance.today)} label="today" />
          </div>
          {/* the headline % is the featured (next-to-play) team; per-team odds sit in each row */}
          {teams.length > 1 && featuredPct != null && featured && (
            <div className="px-[18px] pt-1.5 text-center font-[var(--font-mono)] text-[9.5px] text-[#5f6981]">
              headline odds: <span className="text-[#9aa4ba]">{featured.name}</span> · each team's below
            </div>
          )}
        </>
      )}

      {/* next game + travel (killer #2) — countdown, venue, drive + weather, directions. self-hides */}
      <div className="mt-3">
        <NextGame games={games} />
      </div>

      {/* conflict radar (killer #3) — self-hides */}
      <div className="mt-3">
        <ConflictRadar tracked={teams} games={games} />
      </div>

      {/* empty state */}
      {teams.length === 0 && (
        <div className="mx-[18px] mt-4 overflow-hidden rounded-[16px] border border-[rgba(255,255,255,0.055)] border-t-[rgba(255,255,255,0.09)] bg-[radial-gradient(240px_130px_at_50%_-10%,rgba(232,144,42,0.10),transparent),linear-gradient(180deg,#151b29,#10141f)] px-6 py-9 text-center">
          <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full border border-[#5a4a25] bg-[rgba(246,204,85,0.10)]">
            <Trophy className="h-6 w-6 text-[#F6CC55]" />
          </div>
          <div className="font-[var(--font-display)] text-[16px] font-bold text-[#f0f3fa]">No teams tracked yet</div>
          <div className="mx-auto mt-1.5 max-w-[280px] text-[12.5px] leading-[1.55] text-[#9aa4ba]">
            Head to <span className="font-semibold text-[#f0f3fa]">Browse</span>, open a tournament, and track your team — it'll live here and follow you to every tournament it plays.
          </div>
        </div>
      )}

      {/* program groups — each team with record + today's pill */}
      <div className="mt-4 space-y-4">
        {model.groups.map((grp) => (
          <div key={grp.program} className="mx-[18px] overflow-hidden rounded-[16px] border border-[rgba(255,255,255,0.055)] bg-[linear-gradient(180deg,#151b29,#10141f)]">
            <div className="flex items-center justify-between border-b border-[rgba(255,255,255,0.055)] px-[15px] py-[11px] font-[var(--font-mono)] text-[10px] uppercase tracking-[0.05em] text-[#cdb98c]">
              <span>{grp.program}{grp.todayCount > 0 ? " · today" : ""}</span>
              <span className="text-[#5f6981]">{grp.todayCount > 0 ? `${grp.todayCount} game${grp.todayCount === 1 ? "" : "s"}` : `${grp.teams.length} team${grp.teams.length === 1 ? "" : "s"}`}</span>
            </div>
            {grp.teams.map((t) => (
              <div key={t.teamKey} className="flex items-center gap-[10px] border-t border-[rgba(255,255,255,0.055)] px-[15px] py-[12px] text-[13px] first:border-t-0">
                <button type="button" onClick={() => setSelected(t.teamKey)} aria-label={`Open ${t.name}`}
                  className="as-press flex min-w-0 flex-1 items-center gap-[10px] text-left">
                  <span className="min-w-0 flex-1 truncate font-semibold text-[#f0f3fa]">{t.name}</span>
                  {(t.record.w > 0 || t.record.l > 0) && (
                    <span className="shrink-0 font-[var(--font-mono)] text-[11px] text-[#9aa4ba]">{t.record.w}–{t.record.l}</span>
                  )}
                  {odds[t.teamKey] != null && (
                    <span className="shrink-0 rounded-[6px] bg-[rgba(246,204,85,0.08)] px-2 py-[3px] font-[var(--font-mono)] text-[10px] font-semibold text-[#F6CC55]">
                      {odds[t.teamKey]}%
                    </span>
                  )}
                  {t.todayPill && (
                    <span className={`shrink-0 font-[var(--font-mono)] text-[10px] rounded-[6px] px-2 py-[3px] ${t.todayPill.won ? "bg-[rgba(94,203,143,0.08)] text-[#5ecb8f]" : "bg-[rgba(246,204,85,0.08)] text-[#F6CC55]"}`}>{t.todayPill.text}</span>
                  )}
                  <ChevronRight className="h-[15px] w-[15px] shrink-0 text-[#454e63]" />
                </button>
                <button type="button" onClick={() => drop(t.teamKey)} aria-label={`Stop tracking ${t.name}`}
                  className="as-press grid h-7 w-7 shrink-0 place-items-center rounded-full border border-[#212939] text-[#5f6981] hover:text-[#ff8a7e]">
                  <X className="h-[13px] w-[13px]" />
                </button>
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* gated capabilities (Saturday-night model + schedule-change watch) in honest pre-gate state */}
      <HomeGatedSections teamCount={teams.length} />
    </div>
  );
}

/** Momentum bar fill: the tracked team's share of total points — fills toward them as
 *  they pull ahead (50% when even, <50% when trailing). */
function heroBar(a: number, b: number): number {
  const t = a + b;
  if (t <= 0) return 50;
  return Math.round((a / t) * 100);
}

function GlanceCard({ value, label, grad = false }: { value: string; label: string; grad?: boolean }) {
  return (
    <div className="flex-1 rounded-[14px] border border-[rgba(255,255,255,0.055)] bg-[linear-gradient(180deg,#151b29,#10141f)] px-[10px] py-3 text-center">
      <div className={`font-[var(--font-display)] text-[19px] font-bold ${grad ? "bg-[linear-gradient(100deg,#E0631C,#E8902A,#F6CC55,#FBD56B)] bg-clip-text text-transparent" : "text-[#f0f3fa]"}`}>{value}</div>
      <div className="mt-[3px] font-[var(--font-mono)] text-[9px] uppercase tracking-[0.05em] text-[#5f6981]">{label}</div>
    </div>
  );
}
