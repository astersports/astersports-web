import type { ReactNode } from "react";
import { ArrowLeft, CalendarClock } from "lucide-react";
import { type TeamGame } from "@/lib/aster";
import type { TrackedTeam } from "@/lib/aau/trackingStore";
import { buildDirections } from "@/lib/aau/buildDirections";
import { pickNextGame } from "@/lib/aau/nextGame";
import { gamesForTeam } from "@/lib/aau/teamGames";
import NextGame from "./NextGame";

// Team detail — the drill-down from My Teams. One tracked team's full game-by-game schedule
// and results: the next game as the travel hero (countdown + drive + weather + directions),
// then Upcoming and Results lists with venue + one-tap directions. Pure read over the
// schedule My Teams already loaded (no extra fetch). No fabrication — a missing score or
// venue is simply omitted.

const DATE = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric" });
const TIME = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" });
const ms = (g: TeamGame) => (g.startAt ? +new Date(g.startAt) : 0);

function record(games: TeamGame[]): { w: number; l: number } {
  let w = 0, l = 0;
  for (const g of games) {
    if (g.status !== "final" || g.myScore == null || g.oppScore == null) continue;
    if (g.myScore > g.oppScore) w++;
    else if (g.myScore < g.oppScore) l++;
  }
  return { w, l };
}

function GameRow({ g }: { g: TeamGame }) {
  const dirs = buildDirections(g.venue ?? null);
  const isFinal = g.status === "final" && g.myScore != null && g.oppScore != null;
  const won = isFinal && (g.myScore as number) > (g.oppScore as number);
  const venueLine = [g.court, g.venue?.name].filter(Boolean).join(" · ");
  return (
    <div className="border-t border-[rgba(0,0,0,0.06)] px-[15px] py-[11px] first:border-t-0">
      <div className="flex items-center gap-3">
        <div className="w-[56px] shrink-0 font-[var(--font-mono)] text-[17.6px] text-[#374151]">
          {g.startAt ? DATE.format(new Date(g.startAt)) : "TBD"}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[20.8px] font-semibold text-[#1A1D23]">
            <span className="text-[#4B5563]">vs</span> {g.opponent || "TBD"}
          </div>
          {venueLine && <div className="mt-0.5 truncate font-[var(--font-mono)] text-[16px] text-[#4B5563]">{venueLine}</div>}
        </div>
        {isFinal ? (
          <span className={`shrink-0 font-[var(--font-mono)] text-[19.2px] font-bold ${won ? "text-[#16A34A]" : "text-[#DC2626]"}`}>
            {won ? "W" : "L"} {g.myScore}–{g.oppScore}
          </span>
        ) : g.status === "live" ? (
          <span className="shrink-0 font-[var(--font-mono)] text-[17.6px] text-[#16A34A]">LIVE {g.myScore ?? 0}–{g.oppScore ?? 0}</span>
        ) : g.startAt ? (
          <span className="shrink-0 font-[var(--font-mono)] text-[19.2px] text-[#8F6708]">{TIME.format(new Date(g.startAt))}</span>
        ) : null}
      </div>
      {!isFinal && dirs && (
        <div className="mt-2 flex gap-2 pl-[68px]">
          <a href={dirs.apple} target="_blank" rel="noopener noreferrer" className="as-press rounded-[9px] border border-[#E2E8F0] px-3 py-1 text-[17.6px] text-[#374151]">Apple</a>
          <a href={dirs.google} target="_blank" rel="noopener noreferrer" className="as-press rounded-[9px] border border-[#E2E8F0] px-3 py-1 text-[17.6px] text-[#374151]">Google</a>
        </div>
      )}
    </div>
  );
}

function Section({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  return (
    <div className="mx-[18px] mt-4 overflow-hidden rounded-[16px] border border-[rgba(0,0,0,0.06)] bg-[linear-gradient(180deg,#F9FAFB,#FFFFFF)]">
      <div className="flex items-center justify-between border-b border-[rgba(0,0,0,0.06)] px-[15px] py-[11px] font-[var(--font-mono)] text-[16px] uppercase tracking-[0.05em] text-[#8F6708]">
        <span>{title}</span>
        <span className="text-[#4B5563]">{count}</span>
      </div>
      {children}
    </div>
  );
}

/** Last-5 form guide: most-recent-first W/L chips from posted finals. Engagement stat (not a
 *  game stat — §16.12) derived purely from results; renders nothing if no final has posted. */
function FormGuide({ results }: { results: TeamGame[] }) {
  // a final with a missing score is NOT a result — exclude it so we never render a fake "L"
  // chip (no-fabrication). results are sorted most-recent-first; take the freshest 5 scored.
  const last5 = results.filter((g) => g.myScore != null && g.oppScore != null).slice(0, 5);
  if (!last5.length) return null;
  const wins = last5.filter((g) => (g.myScore as number) > (g.oppScore as number)).length;
  // chips render oldest→newest left-to-right, so the freshest result sits at the right edge
  const chips = last5.slice().reverse();
  return (
    <div className="flex items-center justify-between border-b border-[rgba(0,0,0,0.06)] bg-[rgba(0,0,0,0.015)] px-[15px] py-[9px]">
      <span className="font-[var(--font-mono)] text-[15.2px] uppercase tracking-[0.08em] text-[#4B5563]">Last {last5.length}</span>
      <span className="flex items-center gap-[5px]" role="img" aria-label={`Last ${last5.length}: ${wins} win${wins === 1 ? "" : "s"}, ${last5.length - wins} loss${last5.length - wins === 1 ? "" : "es"}`}>
        {chips.map((g) => {
          const won = (g.myScore as number) > (g.oppScore as number);
          return (
            <span key={g.gameId} aria-hidden="true"
              className={`grid h-[18px] w-[18px] place-items-center rounded-[5px] font-[var(--font-mono)] text-[16px] font-bold ${won ? "bg-[rgba(22,163,74,0.12)] text-[#16A34A]" : "bg-[rgba(220,38,38,0.10)] text-[#DC2626]"}`}>
              {won ? "W" : "L"}
            </span>
          );
        })}
      </span>
    </div>
  );
}

export default function TeamDetail({ team, games, onBack }: { team: TrackedTeam; games: TeamGame[]; onBack: () => void }) {
  const mine = gamesForTeam(games, team);
  const next = pickNextGame(mine);
  // the next game is the travel hero, so keep it out of the Upcoming list to avoid a repeat
  const upcoming = mine.filter((g) => g.status !== "final" && g.gameId !== next?.gameId).sort((a, b) => ms(a) - ms(b));
  const results = mine.filter((g) => g.status === "final").sort((a, b) => ms(b) - ms(a));
  const rec = record(mine);
  const meta = [team.divisionName || team.program, rec.w || rec.l ? `${rec.w}–${rec.l}` : null, team.tournamentName].filter(Boolean).join(" · ");

  return (
    <div className="as-fade-in pb-6">
      <button type="button" onClick={onBack} aria-label="Back to My Teams" className="as-press mx-[18px] mt-[14px] flex min-h-[44px] items-center gap-1.5 text-[19.2px] font-semibold text-[#374151]">
        <ArrowLeft className="h-[15px] w-[15px]" aria-hidden="true" /> My Teams
      </button>
      <div className="px-[18px] pb-1 pt-2">
        <h2 className="font-[var(--font-display)] text-[26.3px] font-bold text-[#1A1D23]">{team.name}</h2>
        {meta && <div className="mt-0.5 font-[var(--font-mono)] text-[16.8px] text-[#4B5563]">{meta}</div>}
      </div>

      {next && <div className="mt-3"><NextGame games={mine} /></div>}

      {upcoming.length > 0 && <Section title="Upcoming" count={upcoming.length}>{upcoming.map((g) => <GameRow key={g.gameId} g={g} />)}</Section>}
      {results.length > 0 && <Section title="Results" count={results.length}><FormGuide results={results} />{results.map((g) => <GameRow key={g.gameId} g={g} />)}</Section>}

      {mine.length === 0 && (
        <div className="mx-[18px] mt-4 overflow-hidden rounded-[16px] border border-[rgba(0,0,0,0.06)] border-t-[rgba(0,0,0,0.10)] bg-[radial-gradient(240px_130px_at_50%_-10%,rgba(232,144,42,0.10),transparent),linear-gradient(180deg,#F9FAFB,#FFFFFF)] px-6 py-9 text-center">
          <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full border border-[#E2C98A] bg-[rgba(246,204,85,0.10)]">
            <CalendarClock className="h-6 w-6 text-[#8F6708]" />
          </div>
          <div className="font-[var(--font-display)] text-[23.2px] font-bold text-[#1A1D23]">Bracket hasn't posted yet</div>
          <div className="mx-auto mt-1.5 max-w-[280px] text-[20px] leading-[1.55] text-[#374151]">
            The moment {team.tournamentName || "the tournament"} posts the bracket, every game lands here — with venue, one-tap directions, and a live countdown to tip.
          </div>
          <div className="mx-auto mt-4 max-w-[260px] font-[var(--font-mono)] text-[16px] uppercase tracking-[0.06em] leading-[1.5] text-[#4B5563]">
            Standings &amp; the predictor are live now under the Standings tab
          </div>
        </div>
      )}
    </div>
  );
}
