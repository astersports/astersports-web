import { Plus } from "lucide-react";
import type { AauTeamVariant } from "@/lib/aster";
import { groupByProgram, hasProgramHeader, type ProgramGroup } from "@/lib/aau/programGroups";
import { C } from "./findUi";
import VariantRow from "./VariantRow";

// Render state 02 Teams section — the §2.E "one High Rise, not five rows" win. Flat variant
// rows from search_public_aau cluster via groupByProgram (presentation-only). A group with
// ≥2 variants renders a program header + nested variant rows; a 1-variant group renders as a
// normal flat row (hasProgramHeader gates the chrome — spec §6 / programGroups guardrail).

function GroupBlock({
  g,
  isTracked,
  onToggle,
  onTrackAll,
}: {
  g: ProgramGroup;
  isTracked: (key: string) => boolean;
  onToggle: (v: AauTeamVariant) => void;
  onTrackAll: (vs: AauTeamVariant[]) => void;
}) {
  if (hasProgramHeader(g)) {
    // first variant carries the program's location-ish context (tournament/division name)
    const head = g.variants[0];
    const allTracked = g.variants.every((v) => isTracked(v.teamKey));
    return (
      <div style={{ borderTop: `1px solid ${C.hair}` }}>
        {/* pinned program header (render .proghead) — "Track all of [club]" bulk action */}
        <div
          className="mx-[18px] mt-[10px] flex items-center justify-between rounded-[13px] px-[13px] py-[11px]"
          style={{ border: "1px solid rgba(246,204,85,.34)", background: "radial-gradient(160px 70px at 12% 0,rgba(246,204,85,.08),transparent),linear-gradient(180deg,#151b29,#10141f)" }}
        >
          <span className="min-w-0">
            <span className="block truncate font-[var(--font-display)] text-[14px] font-bold" style={{ color: C.ink }}>
              {g.program}
            </span>
            <span className="mt-[2px] block font-[var(--font-mono)] text-[10px]" style={{ color: C.mut }}>
              club · {g.variants.length} team{g.variants.length === 1 ? "" : "s"} match
            </span>
          </span>
          <button
            type="button"
            onClick={() => onTrackAll(g.variants)}
            disabled={allTracked}
            aria-label={`Track all ${g.variants.length} ${g.program} teams`}
            className="as-press flex min-h-[44px] shrink-0 items-center gap-[5px] font-[var(--font-mono)] text-[11px] font-bold"
            style={{ color: allTracked ? C.mut : C.g3 }}
          >
            <Plus className="h-[11px] w-[11px]" /> {allTracked ? "All tracked" : "Track all"}
          </button>
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
  onTrackAll,
}: {
  teams: AauTeamVariant[];
  isTracked: (key: string) => boolean;
  onToggle: (v: AauTeamVariant) => void;
  onTrackAll: (vs: AauTeamVariant[]) => void;
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
        <GroupBlock key={g.key} g={g} isTracked={isTracked} onToggle={onToggle} onTrackAll={onTrackAll} />
      ))}
    </section>
  );
}
