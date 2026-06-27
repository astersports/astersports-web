import type { AauTeamVariant } from "@/lib/aster";
import { groupByProgram, hasProgramHeader, type ProgramGroup } from "@/lib/aau/programGroups";
import { initials, C } from "./findUi";
import VariantRow from "./VariantRow";

// Render state 02 Teams section — the §2.E "one High Rise, not five rows" win. Flat variant
// rows from search_public_aau cluster via groupByProgram (presentation-only). A group with
// ≥2 variants renders a program header + nested variant rows; a 1-variant group renders as a
// normal flat row (hasProgramHeader gates the chrome — spec §6 / programGroups guardrail).

function GroupBlock({
  g,
  isTracked,
  onToggle,
}: {
  g: ProgramGroup;
  isTracked: (key: string) => boolean;
  onToggle: (v: AauTeamVariant) => void;
}) {
  if (hasProgramHeader(g)) {
    // first variant carries the program's location-ish context (tournament/division name)
    const head = g.variants[0];
    return (
      <div style={{ borderTop: `1px solid ${C.hair}` }}>
        <div className="flex items-center gap-[12px] px-[18px] pb-[7px] pt-[11px]">
          <span
            className="grid h-[38px] w-[38px] shrink-0 place-items-center rounded-[11px] font-[var(--font-display)] text-[15px] font-bold"
            style={{ background: "rgba(95,160,230,.14)", color: C.cobalt, border: "1px solid rgba(95,160,230,.28)" }}
            aria-hidden
          >
            {initials(g.program)}
          </span>
          <span>
            <span className="block font-[var(--font-display)] text-[15px] font-bold" style={{ color: C.ink }}>
              {g.program}
            </span>
            <span className="mt-[2px] block font-[var(--font-mono)] text-[10.5px]" style={{ color: C.mut }}>
              program · {head.tournamentName} · {g.variants.length} teams
            </span>
          </span>
        </div>
        {g.variants.map((v) => (
          <VariantRow key={`${v.teamKey}:${v.divisionId}`} v={v} tracked={isTracked(v.teamKey)} onToggle={onToggle} nested />
        ))}
      </div>
    );
  }
  // standalone (null hint) OR single-variant program → flat row, no header chrome
  const v = g.variants[0];
  return (
    <div style={{ borderTop: `1px solid ${C.hair}` }}>
      <VariantRow v={v} tracked={isTracked(v.teamKey)} onToggle={onToggle} nested={false} />
    </div>
  );
}

export default function TeamsResults({
  teams,
  isTracked,
  onToggle,
}: {
  teams: AauTeamVariant[];
  isTracked: (key: string) => boolean;
  onToggle: (v: AauTeamVariant) => void;
}) {
  if (teams.length === 0) return null;
  const groups = groupByProgram(teams);
  const programCount = groups.filter(hasProgramHeader).length;
  const countLabel =
    programCount > 0
      ? `${programCount} program${programCount === 1 ? "" : "s"} · ${teams.length} team${teams.length === 1 ? "" : "s"}`
      : `${teams.length} team${teams.length === 1 ? "" : "s"}`;

  return (
    <section className="mt-[6px]" aria-label="Team results">
      <div
        className="flex items-center justify-between px-[18px] pb-[6px] pt-[9px] font-[var(--font-mono)] text-[10px] uppercase tracking-[0.08em]"
        style={{ color: "#cdb98c" }}
      >
        <span>Teams</span>
        <span style={{ color: C.mut }}>{countLabel}</span>
      </div>
      {groups.map((g) => (
        <GroupBlock key={g.key} g={g} isTracked={isTracked} onToggle={onToggle} />
      ))}
    </section>
  );
}
