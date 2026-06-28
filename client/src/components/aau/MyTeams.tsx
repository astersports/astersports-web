import { useEffect, useMemo, useState } from "react";
import { Users, X, ChevronRight } from "lucide-react";
import { getTracked, untrack, TRACKED_EVENT, type TrackedTeam } from "@/lib/aau/trackingStore";
import { getTrackedTeamSchedule, type TeamGame } from "@/lib/aster";
import { buildMyTeamsModel, type MyTeamsModel } from "@/lib/aau/myTeamsModel";
import ConflictRadar from "./ConflictRadar";
import NextGame from "./NextGame";
import TeamDetail from "./TeamDetail";
import HomeGatedSections from "./HomeGatedSections";

// Home command center — render-faithful. Header + "updating live" (only when a tracked team is in
// progress), a live score hero, three glance stats (to-advance · live now · today), and tracked
// teams grouped by program with each team's record + today's pill. Records come from FINAL games;
// live/today from status + start times. The "to-advance" likelihood is SUPPRESSED to "—" everywhere
// on this screen — per the exact-vs-estimate constitution, no surface shows a model likelihood it
// hasn't earned, and a clinched team never shows a probability. The exact clinch/in-the-cut/bubble/
// out status lights up with the §2.B bracket engine; the calibrated % only once F1 calibrates. No
// fabrication — the hero exists only when a game is in progress; absent data degrades quietly.

export default function MyTeams() {
  const [teams, setTeams] = useState<TrackedTeam[]>([]);
  const [games, setGames] = useState<TeamGame[]>([]);
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

  const drop = (key: string) => setTeams(untrack(key));
  const liveActive = model.glance.liveNow > 0;

  // team detail drill-down (game-by-game schedule + results + directions)
  const sel = selected ? teams.find((t) => t.teamKey === selected) : null;
  if (sel) return <TeamDetail team={sel} games={games} onBack={() => setSelected(null)} />;

  return (
    <div className="as-fade-in pb-6">
      {/* page header */}
      <div className="flex items-center justify-between px-[18px] pb-1 pt-[14px]">
        <div>
          <h2 className="font-[var(--font-display)] text-[21px] font-bold text-[#1A1D23]">Home</h2>
          <div className="mt-0.5 font-[var(--font-mono)] text-[10.5px] text-[#4B5563]">
            {teams.length ? `${teams.length} tracked${programLabel ? ` · ${programLabel}` : ""}` : "your weekend, handled"}
          </div>
        </div>
        {liveActive ? (
          <span className="flex items-center gap-1.5 rounded-full border border-[rgba(22,163,74,0.3)] bg-[rgba(22,163,74,0.05)] px-[11px] py-[5px] font-[var(--font-mono)] text-[9.5px] text-[#16A34A]">
            <span className="h-2 w-2 animate-pulse rounded-full bg-[#16A34A] shadow-[0_0_10px_rgba(22,163,74,0.7)]" /> updating live
          </span>
        ) : (
          <Users className="h-5 w-5 text-[#4B5563]" />
        )}
      </div>

      {/* live score hero — only when a tracked team is in progress */}
      {model.hero && (
        <div className="mx-[18px] mt-[10px] overflow-hidden rounded-[18px] border border-[rgba(22,163,74,0.28)] bg-[radial-gradient(300px_120px_at_20%_0%,rgba(22,163,74,0.12),transparent),linear-gradient(180deg,#F1F3F5,#FFFFFF)] shadow-[0_16px_40px_-24px_rgba(22,163,74,0.4)]">
          <div className="flex items-center justify-between border-b border-[rgba(0,0,0,0.06)] px-[15px] py-[11px] font-[var(--font-mono)] text-[10px] text-[#16A34A]">
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 animate-pulse rounded-full bg-[#16A34A]" /> LIVE{model.hero.pool ? ` · ${model.hero.pool}` : ""}</span>
            <span>{model.hero.division}</span>
          </div>
          <div className="flex items-center justify-between px-4 pb-2 pt-[14px]">
            <div className="w-[86px] shrink-0">
              <div className="font-[var(--font-display)] text-[15px] font-semibold leading-[1.12] text-[#166534]">{model.hero.myName}</div>
            </div>
            <div className={`font-[var(--font-mono)] text-[32px] font-bold tracking-[-1px] ${model.hero.myWinning ? "text-[#8F6708]" : "text-[#1A1D23]"}`}>{model.hero.myScore}</div>
            <div className="px-[9px] font-[var(--font-mono)] text-[11px] text-[#9CA3AF]">–</div>
            <div className="font-[var(--font-mono)] text-[32px] font-bold tracking-[-1px] text-[#1A1D23]">{model.hero.oppScore}</div>
            <div className="w-[86px] shrink-0 text-right">
              <div className="font-[var(--font-display)] text-[15px] font-semibold leading-[1.12] text-[#1A1D23]">{model.hero.oppName}</div>
            </div>
          </div>
          <div className="mx-4 mb-[14px] h-1 overflow-hidden rounded-[2px] bg-[rgba(0,0,0,0.06)]">
            <i className="block h-full rounded-[2px] bg-[linear-gradient(90deg,#E8902A,#F6CC55)]" style={{ width: `${heroBar(model.hero.myScore, model.hero.oppScore)}%` }} />
          </div>
        </div>
      )}

      {/* glance stats */}
      {teams.length > 0 && (
        <>
          <div className="flex gap-[10px] px-[18px] pt-3">
            <GlanceCard value="—" label="to advance" grad />
            <GlanceCard value={String(model.glance.liveNow)} label="live now" />
            <GlanceCard value={String(model.glance.today)} label="today" />
          </div>
          {/* to-advance is suppressed until the bracket engine + calibration earn it (constitution) */}
          <div className="px-[18px] pt-1.5 text-center font-[var(--font-mono)] text-[9.5px] text-[#4B5563]">
            To-advance status computes when pool play wraps — no estimate before the model earns it.
          </div>
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
        <div className="mx-[18px] mt-4 overflow-hidden rounded-[18px] border border-[rgba(255,255,255,0.08)] bg-[radial-gradient(360px_180px_at_50%_-15%,rgba(232,144,42,0.20),transparent),linear-gradient(160deg,#151525,#0b1c38)] px-6 py-10 text-center shadow-[0_10px_30px_rgba(11,28,58,0.30)]">
          {/* brand splash — shown whenever no teams are tracked (first run, or any visitor with an empty board) */}
          <img src="/aster-mark.png" alt="" aria-hidden="true" className="mx-auto mb-3 h-[60px] w-auto" />
          <div className="font-[var(--font-display)] text-[20px] font-bold tracking-[-0.01em] text-[#F5F0E8]">Aster Sports</div>
          <div className="mt-1 font-[var(--font-mono)] text-[11px] uppercase tracking-[0.14em] text-[rgba(246,204,85,0.85)]">Every team, every sport</div>
          <div className="mx-auto mt-5 h-px w-16 bg-[rgba(255,255,255,0.12)]" />
          <div className="mt-4 font-[var(--font-display)] text-[15px] font-bold text-[#F5F0E8]">No teams tracked yet</div>
          <div className="mx-auto mt-1.5 max-w-[300px] text-[12.5px] leading-[1.55] text-[rgba(245,240,232,0.70)]">
            Head to <span className="font-semibold text-[#F6CC55]">Browse</span>, open a tournament, and track your team — it'll live here and follow you to every tournament it plays.
          </div>
        </div>
      )}

      {/* program groups — each team with record + today's pill */}
      <div className="mt-4 space-y-4">
        {model.groups.map((grp) => (
          <div key={grp.program} className="mx-[18px] overflow-hidden rounded-[16px] border border-[rgba(0,0,0,0.06)] bg-[linear-gradient(180deg,#F9FAFB,#FFFFFF)]">
            <div className="flex items-center justify-between border-b border-[rgba(0,0,0,0.06)] px-[15px] py-[11px] font-[var(--font-mono)] text-[10px] uppercase tracking-[0.05em] text-[#8F6708]">
              <span>{grp.program}{grp.todayCount > 0 ? " · today" : ""}</span>
              <span className="text-[#4B5563]">{grp.todayCount > 0 ? `${grp.todayCount} game${grp.todayCount === 1 ? "" : "s"}` : `${grp.teams.length} team${grp.teams.length === 1 ? "" : "s"}`}</span>
            </div>
            {grp.teams.map((t) => {
              // disambiguator (architect §1): division (gender·grade) · tournament — so five
              // identically-named "Aster AAU" rows are distinguishable + safe to remove. Threaded
              // into the aria-labels too, or screen-reader users still hear five identical labels.
              const qual = [t.divisionName, t.tournamentName].filter(Boolean).join(" · ");
              const labelName = qual ? `${t.name} · ${qual}` : t.name;
              return (
              <div key={t.teamKey} className="flex items-center gap-[10px] border-t border-[rgba(0,0,0,0.06)] px-[15px] py-[12px] text-[13px] first:border-t-0">
                <button type="button" onClick={() => setSelected(t.teamKey)} aria-label={`Open ${labelName}`}
                  className="as-press flex min-w-0 flex-1 items-center gap-[10px] text-left">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold text-[#1A1D23]">{t.name}</span>
                    {qual && (
                      <span className="mt-[2px] block truncate font-[var(--font-mono)] text-[10.5px] text-[#4B5563]">
                        {qual}
                      </span>
                    )}
                  </span>
                  {(t.record.w > 0 || t.record.l > 0) && (
                    <span className="shrink-0 font-[var(--font-mono)] text-[11px] text-[#374151]">{t.record.w}–{t.record.l}</span>
                  )}
                  {t.todayPill && (
                    <span className={`shrink-0 font-[var(--font-mono)] text-[10px] rounded-[6px] px-2 py-[3px] ${t.todayPill.won ? "bg-[rgba(94,203,143,0.08)] text-[#16A34A]" : "bg-[rgba(246,204,85,0.08)] text-[#8F6708]"}`}>{t.todayPill.text}</span>
                  )}
                  <ChevronRight className="h-[15px] w-[15px] shrink-0 text-[#9CA3AF]" />
                </button>
                <button type="button" onClick={() => drop(t.teamKey)} aria-label={`Stop tracking ${labelName}`}
                  className="as-press grid h-7 w-7 shrink-0 place-items-center rounded-full border border-[#E2E8F0] text-[#4B5563] hover:text-[#DC2626]">
                  <X className="h-[13px] w-[13px]" />
                </button>
              </div>
              );
            })}
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
  // Aster broadcast treatment (matches StatHeroBar): navy tile + Space Mono data face +
  // brand-gold number. The number pops gold when the stat is live ("to advance" always,
  // live-now / today when > 0) and stays a calm warm-white at zero so a "0" doesn't shout.
  const active = grad || Number(value) > 0;
  return (
    <div className="relative flex-1 overflow-hidden rounded-[14px] border border-[rgba(255,255,255,0.08)] bg-[linear-gradient(160deg,#13294d,#0b1c38)] px-[10px] py-3 text-center shadow-[0_2px_10px_rgba(11,28,58,0.30)]">
      {/* gold underline ties each tile to the brand gradient on the countdown below */}
      <i aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 block h-[2px] bg-[linear-gradient(90deg,#E0631C,#E8902A,#F6CC55,#FBD56B)]" />
      <div className={`font-[var(--font-mono)] text-[22px] font-bold leading-none tracking-[-0.5px] ${active ? "bg-[linear-gradient(100deg,#E0631C,#E8902A,#F6CC55,#FBD56B)] bg-clip-text text-transparent" : "text-[rgba(245,240,232,0.45)]"}`}>{value}</div>
      <div className="mt-[5px] font-[var(--font-mono)] text-[9px] font-semibold uppercase tracking-[0.08em] text-[rgba(246,204,85,0.85)]">{label}</div>
    </div>
  );
}
