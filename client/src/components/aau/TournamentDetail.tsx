import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Plus, Trophy } from "lucide-react";
import { getTournamentGames, type DirTournament, type DirDivision, type TournamentGame } from "@/lib/aster";
import { fmtRange } from "@/lib/aau/dates";
import { C } from "./find/findUi";
import DivisionStandings from "./standings/DivisionStandings";

// Tournament Detail — ONE page for a whole tournament: a live scoreboard (games + scores, polled),
// the divisions (tap → live standings), and the Track action. Public Plane A (reads
// get_public_tournament_games + the standings RPCs). This is where Find's tournament tap lands; the
// updated scores from the live-score poll surface here. No fabricated data — every value from RPC.

const ET = "America/New_York";
const dayKeyET = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-CA", { timeZone: ET }) : "tbd");
const dayLabelET = (iso: string) => new Date(iso).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: ET });
const timeET = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: ET }) : "TBD");

function divLabel(g: TournamentGame): string {
  return [g.gender === "F" ? "Girls" : g.gender === "M" ? "Boys" : g.gender, g.gradeLabel, g.tier].filter(Boolean).join(" · ");
}

function ScoreRow({ g }: { g: TournamentGame }) {
  const live = g.status === "live";
  const lit = g.homeScore != null && g.awayScore != null;
  const homeWon = lit && (g.homeScore ?? 0) > (g.awayScore ?? 0);
  const awayWon = lit && (g.awayScore ?? 0) > (g.homeScore ?? 0);
  return (
    <div className="flex items-center gap-[11px] py-[9px]" style={{ borderTop: `1px solid ${C.hair}` }}>
      <span className="w-[58px] shrink-0 font-[var(--font-mono)] text-[10px]" style={{ color: live ? C.live : C.mut }}>
        {live ? (
          <span className="inline-flex items-center gap-1">
            <span className="as-pulse inline-block h-[6px] w-[6px] rounded-full" style={{ background: C.live, boxShadow: `0 0 6px ${C.live}` }} aria-hidden />
            LIVE
          </span>
        ) : g.status === "final" ? "Final" : timeET(g.startAt)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center justify-between gap-2">
          <span className="truncate text-[13px]" style={{ color: awayWon ? C.ink : C.dim, fontWeight: awayWon ? 600 : 400 }}>{g.away}</span>
          <span className="shrink-0 font-[var(--font-mono)] text-[13px] font-bold" style={{ color: lit ? (awayWon ? C.ink : C.mut) : C.faint }}>{g.awayScore ?? "—"}</span>
        </span>
        <span className="mt-[2px] flex items-center justify-between gap-2">
          <span className="truncate text-[13px]" style={{ color: homeWon ? C.ink : C.dim, fontWeight: homeWon ? 600 : 400 }}>{g.home}</span>
          <span className="shrink-0 font-[var(--font-mono)] text-[13px] font-bold" style={{ color: lit ? (homeWon ? C.ink : C.mut) : C.faint }}>{g.homeScore ?? "—"}</span>
        </span>
        <span className="mt-[3px] block truncate font-[var(--font-mono)] text-[9.5px]" style={{ color: C.mut }}>
          {[divLabel(g), g.court, g.venue?.name].filter(Boolean).join(" · ")}
        </span>
      </span>
    </div>
  );
}

export default function TournamentDetail({ tournament, onBack, onTrack }: { tournament: DirTournament; onBack: () => void; onTrack: () => void }) {
  const [games, setGames] = useState<TournamentGame[] | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [division, setDivision] = useState<DirDivision | null>(null);

  // poll every 30s so live scores refresh while a tournament is in progress
  useEffect(() => {
    let active = true;
    const load = () =>
      getTournamentGames(tournament.id)
        .then((g) => active && (setGames(g), setError(null)))
        .catch((e) => active && setError(e as Error));
    load();
    const t = setInterval(load, 30_000);
    return () => { active = false; clearInterval(t); };
  }, [tournament.id]);

  const live = useMemo(() => (games ?? []).filter((g) => g.status === "live"), [games]);
  const byDay = useMemo(() => {
    const m = new Map<string, TournamentGame[]>();
    for (const g of games ?? []) {
      if (g.status === "live") continue; // live shown in its own pinned section
      const k = dayKeyET(g.startAt);
      (m.get(k) ?? m.set(k, []).get(k)!).push(g);
    }
    return Array.from(m.entries()).sort((a, b) => (a[0] < b[0] ? -1 : 1));
  }, [games]);

  // division detail sub-view (reuses the live standings + bracket-odds surface)
  if (division) {
    return (
      <div className="as-fade-in">
        <button type="button" onClick={() => setDivision(null)} className="as-press mb-3 inline-flex min-h-[44px] items-center gap-1 font-[var(--font-mono)] text-[11px]" style={{ color: C.mut }}>
          <ChevronLeft className="h-4 w-4" /> {tournament.name}
        </button>
        <DivisionStandings divisionId={division.id} divisionName={division.name} />
      </div>
    );
  }

  return (
    <div className="as-fade-in">
      <button type="button" onClick={onBack} className="as-press mb-2 inline-flex min-h-[44px] items-center gap-1 font-[var(--font-mono)] text-[11px]" style={{ color: C.mut }}>
        <ChevronLeft className="h-4 w-4" /> Find
      </button>

      {/* header */}
      <div className="px-[18px]">
        {tournament.circuit && (
          <div className="font-[var(--font-mono)] text-[10px] uppercase tracking-[0.12em]" style={{ color: "#cdb98c" }}>{tournament.circuit}</div>
        )}
        <h2 className="mt-1 font-[var(--font-display)] text-[22px] font-bold tracking-[-0.3px]" style={{ color: C.ink }}>{tournament.name}</h2>
        <div className="mt-[5px] font-[var(--font-mono)] text-[11px]" style={{ color: C.dim }}>
          {[fmtRange(tournament.start_date, tournament.end_date), tournament.states.length ? tournament.states.join("/") : null, `${tournament.divisions.length} divisions`].filter(Boolean).join(" · ")}
        </div>
        <button type="button" onClick={onTrack} className="as-press mt-3 inline-flex min-h-[44px] items-center gap-[7px] rounded-[12px] px-[15px] text-[13px] font-semibold" style={{ background: C.grad, color: "#1a1206" }}>
          <Plus className="h-[15px] w-[15px]" /> Track teams
        </button>
      </div>

      {error && (
        <div className="mx-[18px] mt-4 rounded-[15px] p-6 text-center text-[12px]" style={{ border: `1px solid ${C.hair}`, background: "linear-gradient(180deg,#151b29,#10141f)", color: C.mut }}>
          Couldn&apos;t reach the scoreboard. Try again in a moment.
        </div>
      )}
      {!games && !error && (
        <div className="mt-4 space-y-[9px] px-[18px]">{[0, 1, 2].map((i) => <div key={i} className="h-[56px] animate-pulse rounded-[13px]" style={{ border: `1px solid ${C.hair}`, background: "rgba(16,20,31,.6)" }} />)}</div>
      )}

      {/* live now (pinned) */}
      {live.length > 0 && (
        <section className="mt-3">
          <div className="mx-[18px] mb-[2px] flex items-center gap-[9px] font-[var(--font-mono)] text-[10px] uppercase tracking-[0.1em]" style={{ color: C.live }}>
            <span className="as-pulse inline-block h-[7px] w-[7px] rounded-full" style={{ background: C.live, boxShadow: `0 0 8px ${C.live}` }} aria-hidden />
            Live now · {live.length}<span className="h-px flex-1" style={{ background: C.hair }} />
          </div>
          <div className="px-[18px]">{live.map((g) => <ScoreRow key={g.gameId} g={g} />)}</div>
        </section>
      )}

      {/* scoreboard grouped by day */}
      {byDay.map(([day, dayGames]) => (
        <section key={day} className="mt-3">
          <div className="mx-[18px] mb-[2px] flex items-center gap-[9px] font-[var(--font-mono)] text-[10px] uppercase tracking-[0.1em]" style={{ color: C.mut }}>
            {day === "tbd" ? "Schedule TBD" : dayLabelET(dayGames[0].startAt!)} · {dayGames.length}
            <span className="h-px flex-1" style={{ background: C.hair }} />
          </div>
          <div className="px-[18px]">{dayGames.map((g) => <ScoreRow key={g.gameId} g={g} />)}</div>
        </section>
      ))}

      {games && games.length === 0 && !error && (
        <div className="mx-[18px] mt-4 rounded-[15px] p-8 text-center" style={{ border: `1px solid ${C.hair}`, background: "linear-gradient(180deg,#151b29,#10141f)" }}>
          <Trophy className="mx-auto mb-3 h-7 w-7" style={{ color: C.mut }} />
          <div className="text-[13px] font-semibold" style={{ color: C.ink }}>Schedule not posted yet</div>
          <div className="mt-1 text-[12px]" style={{ color: C.mut }}>Games appear here once the bracket is released.</div>
        </div>
      )}

      {/* divisions → live standings */}
      <section className="mt-5">
        <div className="mx-[18px] mb-[6px] font-[var(--font-mono)] text-[10px] uppercase tracking-[0.1em]" style={{ color: "#cdb98c" }}>Divisions · standings</div>
        {tournament.divisions.map((d) => (
          <button key={d.id} type="button" onClick={() => setDivision(d)} className="as-press flex w-full items-center gap-[11px] px-[18px] py-[11px] text-left" style={{ borderTop: `1px solid ${C.hair}` }}>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-semibold" style={{ color: C.ink }}>{d.name}</span>
              <span className="mt-[2px] block font-[var(--font-mono)] text-[10px]" style={{ color: C.mut }}>
                {[`${d.team_count} teams`, d.advance_count ? `top ${d.advance_count} advance` : null].filter(Boolean).join(" · ")}
              </span>
            </span>
            <ChevronRight className="h-4 w-4 shrink-0" style={{ color: C.mut }} />
          </button>
        ))}
      </section>
    </div>
  );
}
