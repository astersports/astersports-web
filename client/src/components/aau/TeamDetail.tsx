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
    <div className="border-t border-[rgba(255,255,255,0.055)] px-[15px] py-[11px] first:border-t-0">
      <div className="flex items-center gap-3">
        <div className="w-[56px] shrink-0 font-[var(--font-mono)] text-[11px] text-[#9aa4ba]">
          {g.startAt ? DATE.format(new Date(g.startAt)) : "TBD"}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold text-[#f0f3fa]">
            <span className="text-[#5f6981]">vs</span> {g.opponent || "TBD"}
          </div>
          {venueLine && <div className="mt-0.5 truncate font-[var(--font-mono)] text-[10px] text-[#5f6981]">{venueLine}</div>}
        </div>
        {isFinal ? (
          <span className={`shrink-0 font-[var(--font-mono)] text-[12px] font-bold ${won ? "text-[#5ecb8f]" : "text-[#ff8a7e]"}`}>
            {won ? "W" : "L"} {g.myScore}–{g.oppScore}
          </span>
        ) : g.status === "live" ? (
          <span className="shrink-0 font-[var(--font-mono)] text-[11px] text-[#34e0a4]">LIVE {g.myScore ?? 0}–{g.oppScore ?? 0}</span>
        ) : g.startAt ? (
          <span className="shrink-0 font-[var(--font-mono)] text-[12px] text-[#F6CC55]">{TIME.format(new Date(g.startAt))}</span>
        ) : null}
      </div>
      {!isFinal && dirs && (
        <div className="mt-2 flex gap-2 pl-[68px]">
          <a href={dirs.apple} target="_blank" rel="noopener noreferrer" className="as-press rounded-[9px] border border-[#212939] px-3 py-1 text-[11px] text-[#9aa4ba]">Apple</a>
          <a href={dirs.google} target="_blank" rel="noopener noreferrer" className="as-press rounded-[9px] border border-[#212939] px-3 py-1 text-[11px] text-[#9aa4ba]">Google</a>
        </div>
      )}
    </div>
  );
}

function Section({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  return (
    <div className="mx-[18px] mt-4 overflow-hidden rounded-[16px] border border-[rgba(255,255,255,0.055)] bg-[linear-gradient(180deg,#151b29,#10141f)]">
      <div className="flex items-center justify-between border-b border-[rgba(255,255,255,0.055)] px-[15px] py-[11px] font-[var(--font-mono)] text-[10px] uppercase tracking-[0.05em] text-[#cdb98c]">
        <span>{title}</span>
        <span className="text-[#5f6981]">{count}</span>
      </div>
      {children}
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
      <button type="button" onClick={onBack} className="as-press mx-[18px] mt-[14px] flex items-center gap-1.5 text-[12px] font-semibold text-[#9aa4ba]">
        <ArrowLeft className="h-[15px] w-[15px]" /> My Teams
      </button>
      <div className="px-[18px] pb-1 pt-2">
        <h2 className="font-[var(--font-display)] text-[21px] font-bold text-[#f0f3fa]">{team.name}</h2>
        {meta && <div className="mt-0.5 font-[var(--font-mono)] text-[10.5px] text-[#5f6981]">{meta}</div>}
      </div>

      {next && <div className="mt-3"><NextGame games={mine} /></div>}

      {upcoming.length > 0 && <Section title="Upcoming" count={upcoming.length}>{upcoming.map((g) => <GameRow key={g.gameId} g={g} />)}</Section>}
      {results.length > 0 && <Section title="Results" count={results.length}>{results.map((g) => <GameRow key={g.gameId} g={g} />)}</Section>}

      {mine.length === 0 && (
        <div className="mx-[18px] mt-4 overflow-hidden rounded-[16px] border border-[rgba(255,255,255,0.055)] border-t-[rgba(255,255,255,0.09)] bg-[radial-gradient(240px_130px_at_50%_-10%,rgba(232,144,42,0.10),transparent),linear-gradient(180deg,#151b29,#10141f)] px-6 py-9 text-center">
          <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full border border-[#5a4a25] bg-[rgba(246,204,85,0.10)]">
            <CalendarClock className="h-6 w-6 text-[#F6CC55]" />
          </div>
          <div className="font-[var(--font-display)] text-[16px] font-bold text-[#f0f3fa]">Bracket hasn't posted yet</div>
          <div className="mx-auto mt-1.5 max-w-[280px] text-[12.5px] leading-[1.55] text-[#9aa4ba]">
            The moment {team.tournamentName || "the tournament"} posts the bracket, every game lands here — with venue, one-tap directions, and a live countdown to tip.
          </div>
          <div className="mx-auto mt-4 max-w-[260px] font-[var(--font-mono)] text-[10px] uppercase tracking-[0.06em] leading-[1.5] text-[#5f6981]">
            Standings &amp; the predictor are live now under the Standings tab
          </div>
        </div>
      )}
    </div>
  );
}
