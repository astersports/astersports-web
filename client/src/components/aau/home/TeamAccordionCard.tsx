import { ChevronDown, ChevronRight } from "lucide-react";
import type { TeamGame } from "@/lib/aster";
import type { TeamUrgency } from "@/lib/aau/hubHome/urgency";
import type { DivisionStanding } from "@/hooks/useDivisionStandings";
import NextGame from "../NextGame";
import DivisionSlice from "./DivisionSlice";
import BracketPath from "./BracketPath";

// "next:" line — Intl.DateTimeFormat (NOT toLocaleDateString, which can drop the time options on
// some engines; Copilot review on #208).
const NEXT_FMT = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "numeric", minute: "2-digit" });

// Hub Home V2 — one collapsible card per tracked team (§5 Zone 3). ONE level of accordion: the
// team. Inside, Up-Next / Division / Bracket-Path / Recent render INLINE; full schedule/results/
// film are deep-links, never a second sub-accordion. Owns ONE useAauStandings(divisionId) call so
// the division slice and the bracket path share the same source (no double fetch). No fabrication —
// every section degrades to its honest absent state (H7).

const norm = (s: string) => s.trim().toLowerCase();

function record(games: TeamGame[]): { w: number; l: number } {
  let w = 0, l = 0;
  for (const g of games) {
    if (g.status !== "final" || g.myScore == null || g.oppScore == null) continue;
    if (g.myScore > g.oppScore) w++; else if (g.myScore < g.oppScore) l++;
  }
  return { w, l };
}

const CHIP: Record<string, { text: string; cls: string }> = {
  clinched: { text: "✓ Clinched", cls: "text-[#16A34A] bg-[rgba(22,163,74,0.10)]" },
  win_and_in: { text: "Win & in", cls: "text-[#8F6708] bg-[rgba(246,204,85,0.16)]" },
  in_control: { text: "In control", cls: "text-[#8F6708] bg-[rgba(246,204,85,0.16)]" },
  must_win: { text: "Must win", cls: "text-[#DC2626] bg-[rgba(220,38,38,0.08)]" },
  needs_help: { text: "On the bubble", cls: "text-[#8F6708] bg-[rgba(246,204,85,0.16)]" },
  eliminated: { text: "Out", cls: "text-[#DC2626] bg-[rgba(220,38,38,0.08)]" },
};

interface Props {
  u: TeamUrgency;
  division: DivisionStanding; // shared per-division standings (one poll per division, lifted to parent)
  expanded: boolean;
  onToggle: () => void;
  onOpenTeam: () => void;
  onOpenDivision: () => void;
}

export default function TeamAccordionCard({ u, division, expanded, onToggle, onOpenTeam, onOpenDivision }: Props) {
  const { team, games, kind, nextGame } = u;
  const { standings, advanceCount, predictFor, loading } = division;
  const focusId = standings.find((r) => r.id === team.teamKey || norm(r.name) === norm(team.name))?.id ?? null;
  // H1: strip oddsPct before it can reach BracketPath — the % is un-passable past this point.
  const { oddsPct: _oddsPct, ...pred } = focusId ? predictFor(focusId) : { available: false as const };
  const rec = record(games);
  const recLabel = rec.w || rec.l ? `${rec.w}–${rec.l}` : null;
  const chip = pred.available && pred.posture ? CHIP[pred.posture] : null;
  const results = games.filter((g) => g.status === "final" && g.myScore != null && g.oppScore != null).sort((a, b) => (a.startAt && b.startAt ? +new Date(b.startAt) - +new Date(a.startAt) : 0));
  const last5 = results.slice(0, 5);

  const nextLine = kind === "live" ? "live now"
    : nextGame?.startAt ? `next: ${NEXT_FMT.format(new Date(nextGame.startAt))}`
    : "no game scheduled";

  return (
    <div className={`overflow-hidden rounded-[16px] border bg-[#FFFFFF] ${kind === "live" ? "border-[rgba(22,163,74,0.35)]" : "border-[rgba(0,0,0,0.08)]"}`}>
      <button type="button" onClick={onToggle} aria-expanded={expanded}
        className="as-press flex w-full items-center gap-3 px-[15px] py-[12px] text-left">
        {expanded ? <ChevronDown className="h-[17px] w-[17px] shrink-0 text-[#4B5563]" aria-hidden="true" /> : <ChevronRight className="h-[17px] w-[17px] shrink-0 text-[#4B5563]" aria-hidden="true" />}
        <span className="min-w-0 flex-1">
          {/* name wraps rather than clips ("Empire State Sto…" → full name); record/chip wrap below
              when tight instead of squeezing the name (architect review) */}
          <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="font-[var(--font-display)] text-[15.5px] font-bold leading-tight text-[#1A1D23]">{team.name}</span>
            {recLabel && <span className="shrink-0 font-[var(--font-mono)] text-[12.6px] text-[#374151]">{recLabel}</span>}
            {chip && <span className={`shrink-0 rounded-full px-2 py-[2px] font-[var(--font-mono)] text-[11px] font-bold ${chip.cls}`}>{chip.text}</span>}
          </span>
          <span className="mt-0.5 block truncate font-[var(--font-mono)] text-[11.5px] text-[#4B5563]">
            {[team.divisionName || team.program, team.tournamentName, nextLine].filter(Boolean).join(" · ")}
          </span>
        </span>
      </button>

      {expanded && (
        <div className="border-t border-[rgba(0,0,0,0.06)] bg-[rgba(0,0,0,0.012)] px-[12px] pb-[14px] pt-[10px]">
          {/* UP NEXT — reuses the single game-day composition (countdown · drive · weather · maps) */}
          {nextGame && <div className="-mx-[6px]"><NextGame games={games} /></div>}

          {/* DIVISION — §5.3 slice from the shared standings source */}
          <div className="mt-2 px-[6px]">
            <SectionLabel>Division</SectionLabel>
            <DivisionSlice rows={standings} advanceCount={advanceCount} focusId={focusId} focusName={team.name} loading={loading} onOpenFull={onOpenDivision} />
          </div>

          {/* BRACKET PATH — exact-count only (H1) */}
          <div className="mt-3 px-[6px]">
            <SectionLabel>Bracket path</SectionLabel>
            <BracketPath p={pred} />
          </div>

          {/* RECENT — last-5 finals, deep-link to the full schedule */}
          {last5.length > 0 && (
            <div className="mt-3 px-[6px]">
              <SectionLabel>Recent</SectionLabel>
              <div className="flex flex-wrap items-center gap-2 rounded-[12px] border border-[rgba(0,0,0,0.06)] bg-[#FFFFFF] px-3 py-2.5">
                {last5.slice().reverse().map((g) => {
                  const won = (g.myScore as number) > (g.oppScore as number);
                  return (
                    <span key={g.gameId} className={`font-[var(--font-mono)] text-[12.6px] font-bold ${won ? "text-[#16A34A]" : "text-[#DC2626]"}`}>
                      {won ? "W" : "L"} {g.isForfeit ? "forfeit" : `${g.myScore}–${g.oppScore}`}
                    </span>
                  );
                })}
                <button type="button" onClick={onOpenTeam} className="as-press ml-auto flex items-center gap-1 font-[var(--font-mono)] text-[11.5px] text-[#374151]">
                  full schedule <ChevronRight className="h-[13px] w-[13px]" aria-hidden="true" />
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="mb-1.5 font-[var(--font-mono)] text-[10.5px] uppercase tracking-[0.1em] text-[#8F6708]">{children}</div>;
}
