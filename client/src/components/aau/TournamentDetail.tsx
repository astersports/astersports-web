import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Plus, Trophy } from "lucide-react";
import { getTournamentGames, type DirTournament, type DirDivision, type TournamentGame } from "@/lib/aster";
import { fmtRange } from "@/lib/aau/dates";
import { C } from "./find/findUi";
import DivisionStandings from "./standings/DivisionStandings";

// Tournament Detail — ONE public page per tournament (Plane A, free, no account): the live
// scoreboard, the divisions (tap → live standings/bracket), and the Track action. This is where
// Find's tournament tap lands and where the live-score poll's updates surface. Binding target:
// docs render aautournamentdetailrender.html (architect-ratified 2026-06-27). No fabricated data —
// every value comes from get_public_tournament_games. Exact scores, honest status (live/final/
// upcoming); no estimates on this surface.
//
// FORWARD FLAG (architect §2 "display by name, navigate by key"): rows render display_name (a
// scoreboard renders discrete game rows and never aggregates by team identity, so display_name is
// safe here). Making a row TAPPABLE into Team Detail crosses into identity and MUST resolve on
// external_team_key — PER SIDE: a game row is team-vs-team, so each row needs BOTH
// home_external_team_key AND away_external_team_key, or half the rows get a dead tap. The games RPC
// does not return them yet; adding them is a body-only CREATE OR REPLACE (the fn RETURNS jsonb, so
// it's two new jsonb keys, not a RETURNS TABLE column drop+create). Owner-applied regardless of the
// apply-gate standing rule (a replace, not a brand-new read fn). That field-pair + the tap is the
// next increment — STAGED and held for the owner's apply-go (build-go ≠ apply-go). Until then: no
// dead tap affordance ships (render-minus-tap is the diff baseline for this increment).

// Division-first IA (architect IA review 2026-06-27): the division list is the front page of a
// tournament — structured + scannable, every division a container with stakes. The flat scoreboard
// is demoted to a secondary "Live glance" (raw scores without a team context are noise).
const TAB_LABEL: Record<"divisions" | "scoreboard", string> = { divisions: "Divisions", scoreboard: "Live glance" };

const ET = "America/New_York";
const dayKeyET = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-CA", { timeZone: ET }) : "tbd");
const dayShortET = (iso: string) => new Date(iso).toLocaleDateString("en-US", { weekday: "short", timeZone: ET });
const timeET = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: ET }) : "TBD");

// Upcoming label keeps the day when a tournament spans more than one (e.g. "Sun · 2:00 PM").
function upcomingLabel(iso: string | null, multiDay: boolean): string {
  if (!iso) return "TBD";
  return (multiDay ? `${dayShortET(iso)} · ` : "") + timeET(iso);
}

function GameCard({ g, multiDay }: { g: TournamentGame; multiDay: boolean }) {
  const live = g.status === "live";
  const final = g.status === "final";
  const lit = g.homeScore != null && g.awayScore != null;
  const homeWon = final && lit && (g.homeScore ?? 0) > (g.awayScore ?? 0);
  const awayWon = final && lit && (g.awayScore ?? 0) > (g.homeScore ?? 0);

  const teamRow = (name: string, score: number | null, won: boolean, lost: boolean) => (
    <div className="flex items-center justify-between gap-2 py-[3px]">
      <span className="truncate font-[var(--font-display)] text-[19.6px]" style={{ color: won ? C.ink : lost ? C.mut : C.dim, fontWeight: 600 }}>{name}</span>
      <span className="shrink-0 font-[var(--font-mono)] text-[24.7px] font-bold" style={{ color: live ? C.live : won ? C.pos : lit ? C.mut : C.faint }}>{score ?? "—"}</span>
    </div>
  );

  return (
    <div className="mb-[9px] rounded-[14px] p-[11px_12px]" style={{ border: `1px solid ${live ? "rgba(22,163,74,.28)" : C.hair}`, background: live ? "linear-gradient(160deg,rgba(22,163,74,.05),#FFFFFF)" : "#FFFFFF" }}>
      <div className="mb-[9px] flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-[6px] font-[var(--font-mono)] text-[16px] font-bold tracking-[0.06em]" style={{ color: live ? C.live : final ? C.mut : "#ffb648" }}>
          {live && <span className="as-pulse inline-block h-[6px] w-[6px] rounded-full" style={{ background: C.live, boxShadow: `0 0 6px ${C.live}` }} aria-hidden />}
          {live ? "LIVE" : final ? "FINAL" : upcomingLabel(g.startAt, multiDay)}
        </span>
        <span className="shrink-0 truncate font-[var(--font-mono)] text-[15.2px]" style={{ color: C.mut, border: `1px solid ${C.hair}`, background: "rgba(0,0,0,0.04)", padding: "2px 7px", borderRadius: 6 }}>{g.divisionName}</span>
      </div>
      {teamRow(g.away, g.awayScore, awayWon, homeWon)}
      {teamRow(g.home, g.homeScore, homeWon, awayWon)}
      <div className="mt-[7px] flex flex-wrap items-center gap-2 pt-[8px] font-[var(--font-mono)] text-[16.8px]" style={{ color: C.mut, borderTop: `1px solid ${C.hair}` }}>
        {g.court && <span>🏀 {g.court}</span>}
        {g.venue?.name && <span style={{ color: C.dim }}>{g.venue.name}</span>}
        {final && g.startAt && <span>· {timeET(g.startAt)}</span>}
      </div>
    </div>
  );
}

function Zone({ label, count }: { label: string; count?: string }) {
  return (
    <div className="mx-1 mb-[9px] mt-4 flex items-center gap-2 font-[var(--font-mono)] text-[16px] uppercase tracking-[0.16em]" style={{ color: C.mut }}>
      {label}
      <span className="h-px flex-1" style={{ background: C.hair }} />
      {count && <span className="tracking-normal lowercase" style={{ color: C.mut }}>{count}</span>}
    </div>
  );
}

export default function TournamentDetail({ tournament, onBack, onTrack }: { tournament: DirTournament; onBack: () => void; onTrack: () => void }) {
  const [games, setGames] = useState<TournamentGame[] | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [tab, setTab] = useState<"scoreboard" | "divisions">("divisions"); // division-first default
  const [divFilter, setDivFilter] = useState<string | null>(null); // division id, scoreboard chip filter
  const [division, setDivision] = useState<DirDivision | null>(null); // division drill-in (standings)

  // poll every 30s so live scores refresh while a tournament is in progress
  useEffect(() => {
    let active = true;
    const load = () =>
      getTournamentGames(tournament.id)
        .then((g) => active && (setGames(g), setError(null), setUpdatedAt(new Date())))
        .catch((e) => active && setError(e as Error));
    load();
    const t = setInterval(load, 30_000);
    return () => { active = false; clearInterval(t); };
  }, [tournament.id]);

  const all = games ?? [];
  const multiDay = useMemo(() => new Set(all.map((g) => dayKeyET(g.startAt))).size > 1, [all]);
  const anyLive = all.some((g) => g.status === "live");
  // division ids that have a live game right now → "live" tag in the Divisions tab
  const liveDivisions = useMemo(() => new Set(all.filter((g) => g.status === "live").map((g) => g.divisionId)), [all]);

  const filtered = divFilter ? all.filter((g) => g.divisionId === divFilter) : all;
  const byStart = (a: TournamentGame, b: TournamentGame) => (a.startAt ?? "") < (b.startAt ?? "") ? -1 : 1;
  const liveGames = filtered.filter((g) => g.status === "live").sort(byStart);
  const finalGames = filtered.filter((g) => g.status === "final").sort((a, b) => -byStart(a, b)); // most-recent final first
  const upcoming = filtered.filter((g) => g.status === "scheduled").sort(byStart);

  // division drill-in sub-view (reuses the live standings + bracket-odds surface)
  if (division) {
    return (
      <div className="as-fade-in">
        <button type="button" onClick={() => setDivision(null)} className="as-press mb-3 inline-flex min-h-[44px] items-center gap-1 font-[var(--font-mono)] text-[17.6px]" style={{ color: C.mut }}>
          <ChevronLeft className="h-4 w-4" /> {tournament.name}
        </button>
        <DivisionStandings divisionId={division.id} divisionName={division.name} />
      </div>
    );
  }

  return (
    <div className="as-fade-in">
      <button type="button" onClick={onBack} className="as-press mb-2 inline-flex min-h-[44px] items-center gap-1 font-[var(--font-mono)] text-[17.6px]" style={{ color: C.mut }}>
        <ChevronLeft className="h-4 w-4" /> Find
      </button>

      {/* tournament header */}
      <div className="rounded-[18px] p-[15px]" style={{ border: `1px solid ${C.hair2}`, background: "linear-gradient(160deg,#F1F3F5,#FFFFFF)" }}>
        {tournament.circuit && (
          <div className="font-[var(--font-mono)] text-[17.6px] uppercase tracking-[0.06em]" style={{ color: C.g3 }}>{tournament.circuit}</div>
        )}
        <h2 className="mt-[2px] font-[var(--font-display)] text-[26.3px] font-bold tracking-[-0.01em]" style={{ color: C.ink }}>{tournament.name}</h2>
        <div className="mt-[9px] flex flex-wrap items-center gap-[7px]">
          {anyLive && (
            <span className="inline-flex items-center gap-[6px] rounded-[7px] px-2 py-[3px] text-[16.8px] font-semibold" style={{ color: C.live, border: "1px solid rgba(22,163,74,.4)", background: "rgba(22,163,74,.08)" }}>
              <span className="as-pulse inline-block h-[6px] w-[6px] rounded-full" style={{ background: C.live }} aria-hidden /> Live now
            </span>
          )}
          {[fmtRange(tournament.start_date, tournament.end_date), tournament.states.length ? tournament.states.join("/") : null, `${tournament.divisions.length} divisions`, games ? `${all.length} games` : null].filter(Boolean).map((t) => (
            <span key={t as string} className="rounded-[7px] px-2 py-[3px] text-[16.8px] font-semibold" style={{ color: C.dim, border: `1px solid ${C.hair}`, background: "rgba(0,0,0,0.04)" }}>{t}</span>
          ))}
        </div>
        <button type="button" onClick={onTrack} className="as-press mt-[13px] flex min-h-[44px] w-full items-center justify-center gap-[7px] rounded-[11px] text-[20.8px] font-bold" style={{ background: C.grad, color: "#1a1206" }}>
          <Plus className="h-[15px] w-[15px]" /> Track a team here
        </button>
      </div>

      {/* in-page tabs */}
      <div className="mb-1 mt-[14px] flex items-center gap-[6px]" style={{ borderBottom: `1px solid ${C.hair}` }} role="tablist" aria-label="Tournament view">
        {(["divisions", "scoreboard"] as const).map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className="as-press min-h-[40px] px-[11px] font-[var(--font-display)] text-[20px] font-semibold" style={{ color: tab === t ? C.g3 : C.mut, borderBottom: `2px solid ${tab === t ? C.g3 : "transparent"}`, marginBottom: -1 }}>
            {TAB_LABEL[t]}
          </button>
        ))}
        {/* live-poll freshness — only meaningful while a game is in progress (poll-driven) */}
        {anyLive && updatedAt && (
          <span className="ml-auto pr-[2px] font-[var(--font-mono)] text-[15.2px]" style={{ color: C.mut }} aria-live="polite">
            Updated {updatedAt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: ET })}
          </span>
        )}
      </div>

      {error && (
        <div className="mt-4 rounded-[15px] p-6 text-center text-[19.2px]" style={{ border: `1px solid ${C.hair}`, background: "linear-gradient(180deg,#F9FAFB,#FFFFFF)", color: C.mut }}>
          Couldn&apos;t reach the scoreboard. Try again in a moment.
        </div>
      )}
      {!games && !error && (
        <div className="mt-4 space-y-[9px]">{[0, 1, 2].map((i) => <div key={i} className="h-[78px] animate-pulse rounded-[14px]" style={{ border: `1px solid ${C.hair}`, background: "rgba(0,0,0,0.04)" }} />)}</div>
      )}

      {/* SCOREBOARD tab */}
      {games && tab === "scoreboard" && (
        <>
          {all.length > 0 && (
            <div className="mt-[10px] flex gap-[7px] overflow-x-auto p-[2px]">
              {[{ id: null as string | null, name: "All" }, ...tournament.divisions.map((d) => ({ id: d.id, name: d.name }))].map((d) => {
                const on = divFilter === d.id;
                return (
                  <button key={d.id ?? "all"} type="button" onClick={() => setDivFilter(d.id)} className="as-press shrink-0 rounded-full px-[11px] py-[6px] text-[17.6px] font-semibold" style={{ color: on ? C.g3 : C.dim, border: `1px solid ${on ? "rgba(246,204,85,.4)" : C.hair2}`, background: on ? "rgba(246,204,85,.07)" : "#FFFFFF" }}>
                    {d.name}
                  </button>
                );
              })}
            </div>
          )}

          {liveGames.length > 0 && <><Zone label="Live now" count={`${liveGames.length} in progress`} />{liveGames.map((g) => <GameCard key={g.gameId} g={g} multiDay={multiDay} />)}</>}
          {finalGames.length > 0 && <><Zone label="Final" count={`${finalGames.length}`} />{finalGames.map((g) => <GameCard key={g.gameId} g={g} multiDay={multiDay} />)}</>}
          {upcoming.length > 0 && <><Zone label="Upcoming" count="next tip" />{upcoming.map((g) => <GameCard key={g.gameId} g={g} multiDay={multiDay} />)}</>}

          {filtered.length === 0 && (
            <div className="mt-4 rounded-[15px] p-8 text-center" style={{ border: `1px solid ${C.hair}`, background: "linear-gradient(180deg,#F9FAFB,#FFFFFF)" }}>
              <Trophy className="mx-auto mb-3 h-7 w-7" style={{ color: C.mut }} />
              <div className="text-[20.8px] font-semibold" style={{ color: C.ink }}>{all.length === 0 ? "Schedule not posted yet" : "No games in this division"}</div>
              <div className="mt-1 text-[19.2px]" style={{ color: C.mut }}>{all.length === 0 ? "Games appear here once the bracket is released." : "Pick another division or All."}</div>
            </div>
          )}
        </>
      )}

      {/* DIVISIONS tab → standings */}
      {games && tab === "divisions" && (
        <div className="mt-2">
          {tournament.divisions.map((d) => (
            <button key={d.id} type="button" onClick={() => setDivision(d)} aria-label={`${d.name} standings${liveDivisions.has(d.id) ? " — live now" : ""}`} className="as-press mb-[9px] flex min-h-[44px] w-full items-center gap-[11px] rounded-[14px] p-[12px] text-left" style={{ border: `1px solid ${C.hair}`, background: "#FFFFFF" }}>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-[var(--font-display)] text-[20.3px] font-semibold" style={{ color: C.ink }}>{d.name}</span>
                <span className="mt-[3px] block font-[var(--font-mono)] text-[17.6px]" style={{ color: C.mut }}>
                  {[`${d.team_count} teams`, d.advance_count ? `top ${d.advance_count} advance` : null].filter(Boolean).join(" · ")}
                </span>
              </span>
              {liveDivisions.has(d.id) && (
                <span className="shrink-0 rounded-[5px] px-[6px] py-[2px] font-[var(--font-mono)] text-[14.4px]" style={{ color: C.live, background: "rgba(22,163,74,.08)", border: "1px solid rgba(22,163,74,.3)" }}>live</span>
              )}
              <ChevronRight className="h-4 w-4 shrink-0" style={{ color: C.mut }} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
