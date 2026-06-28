import { Trophy, Grid3x3 } from "lucide-react";
import type { AauSearchResult, AauTeamVariant, AauTournamentHit, AauDivisionHit } from "@/lib/aster";
import { fmtRange } from "@/lib/aau/dates";
import { initials, seasonOf, C } from "./findUi";
import TeamsResults from "./ProgramGroupCard";

// Render state 02 "Smart results" — three TYPED sections in order: Teams (program-grouped),
// Tournaments, Divisions. A section with 0 hits is OMITTED (spec §4 partial state). Teams carry
// value-in-row; tournaments open via onOpenTournament; divisions are read-only rows (label +
// tournament + team count). aria-live on the count for the screen-reader announce (spec §4 a11y).

function TournamentRow({ t, onOpen }: { t: AauTournamentHit; onOpen: (id: string) => void }) {
  const meta = [t.circuit, t.startDate ? `${seasonOf(t.startDate)}` : null, t.startDate ? fmtRange(t.startDate, t.endDate ?? t.startDate) : null, `${t.divisionCount} division${t.divisionCount === 1 ? "" : "s"}`]
    .filter(Boolean)
    .join(" · ");
  return (
    <button
      type="button"
      onClick={() => onOpen(t.tournamentId)}
      className="as-press flex w-full items-center gap-[12px] px-[18px] py-[11px] text-left"
      style={{ borderTop: `1px solid ${C.hair}` }}
    >
      <span
        className="grid h-[38px] w-[38px] shrink-0 place-items-center rounded-[11px] font-[var(--font-display)] text-[17.3px] font-bold"
        style={{ background: "rgba(232,144,42,.13)", color: C.g3, border: "1px solid #E2C98A" }}
        aria-hidden
      >
        {initials(t.name)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-[7px] font-[var(--font-display)] text-[14.6px] font-semibold" style={{ color: C.ink }}>
          <span className="truncate">{t.name}</span>
          {t.isLive && <span className="inline-block h-[7px] w-[7px] shrink-0 rounded-full" style={{ background: C.live, boxShadow: `0 0 7px ${C.live}` }} aria-hidden />}
        </span>
        <span className="mt-[3px] block truncate font-[var(--font-mono)] text-[12.6px]" style={{ color: C.mut }}>
          {meta}
        </span>
      </span>
      <span className="shrink-0 rounded-[8px] px-[11px] py-[6px] font-[var(--font-mono)] text-[11.5px]" style={{ border: `1px solid ${C.line}`, color: C.dim }}>
        Open
      </span>
    </button>
  );
}

function DivisionRow({ d }: { d: AauDivisionHit }) {
  return (
    <div className="flex items-center gap-[12px] px-[18px] py-[11px]" style={{ borderTop: `1px solid ${C.hair}` }}>
      <span
        className="grid h-[38px] w-[38px] shrink-0 place-items-center rounded-[11px] font-[var(--font-display)] text-[17.3px] font-bold"
        style={{ background: "rgba(94,203,143,.12)", color: C.pos, border: "1px solid rgba(94,203,143,.28)" }}
        aria-hidden
      >
        {initials(d.label ?? "Division")}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-[var(--font-display)] text-[14.6px] font-semibold" style={{ color: C.ink }}>
          {d.label ?? "Division"}
        </span>
        <span className="mt-[3px] block truncate font-[var(--font-mono)] text-[12.6px]" style={{ color: C.mut }}>
          {d.tournamentName} · {d.teamCount} team{d.teamCount === 1 ? "" : "s"}
        </span>
      </span>
    </div>
  );
}

export default function SearchResults({
  result,
  isTracked,
  onToggleTeam,
  onTrackAll,
  onOpenTournament,
}: {
  result: AauSearchResult;
  isTracked: (key: string) => boolean;
  onToggleTeam: (v: AauTeamVariant) => void;
  onTrackAll: (vs: AauTeamVariant[]) => void;
  onOpenTournament: (tournamentId: string) => void;
}) {
  const total = result.teams.length + result.tournaments.length + result.divisions.length;
  return (
    <div className="as-fade-in">
      <p className="sr-only" aria-live="polite">
        {total} result{total === 1 ? "" : "s"} found
      </p>

      <TeamsResults teams={result.teams} isTracked={isTracked} onToggle={onToggleTeam} onTrackAll={onTrackAll} />

      {result.tournaments.length > 0 && (
        <section className="mt-[6px]" aria-label="Tournament results">
          <div className="flex items-center gap-[6px] px-[18px] pb-[6px] pt-[9px] font-[var(--font-mono)] text-[11.5px] uppercase tracking-[0.08em]" style={{ color: "#8F6708" }}>
            <Trophy className="h-[11px] w-[11px]" /> Tournaments
          </div>
          {result.tournaments.map((t) => (
            <TournamentRow key={t.tournamentId} t={t} onOpen={onOpenTournament} />
          ))}
        </section>
      )}

      {result.divisions.length > 0 && (
        <section className="mt-[6px]" aria-label="Division results">
          <div className="flex items-center gap-[6px] px-[18px] pb-[6px] pt-[9px] font-[var(--font-mono)] text-[11.5px] uppercase tracking-[0.08em]" style={{ color: "#8F6708" }}>
            <Grid3x3 className="h-[11px] w-[11px]" /> Divisions
          </div>
          {result.divisions.map((d) => (
            <DivisionRow key={d.divisionId} d={d} />
          ))}
        </section>
      )}
    </div>
  );
}
