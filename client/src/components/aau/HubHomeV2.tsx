import { useEffect, useMemo, useState } from "react";
import { getTracked, TRACKED_EVENT, type TrackedTeam } from "@/lib/aau/trackingStore";
import { getTrackedTeamSchedule, type TeamGame } from "@/lib/aster";
import { buildMyTeamsModel } from "@/lib/aau/myTeamsModel";
import { rankTeams, mostUrgent } from "@/lib/aau/hubHome/urgency";
import { useDivisionStandings } from "@/hooks/useDivisionStandings";
import HeroSlot from "./home/HeroSlot";
import StatusStrip from "./home/StatusStrip";
import TeamAccordionCard from "./home/TeamAccordionCard";
import TeamDetail from "./TeamDetail";
import DivisionStandings from "./standings/DivisionStandings";
import HomeGatedSections from "./HomeGatedSections";

// Hub Home V2 (work order: hero + per-team accordion). The always-current dashboard for a parent
// tracking one team or many: a fixed urgency-selected hero (§4), a derived status strip (§5/Zone 2),
// and an urgency-sorted accordion stack (§5/Zone 3). Read-only over data the hub already consumes;
// no schema/money/calibration dependency. Honesty rules §6 hold — no probability %, no live-claiming
// agent console (H8), Film stays guardian-gated (H9, via HomeGatedSections). Smart defaults §7:
// one team → expanded; many → only the most-urgent expanded; a team goes live → it floats top and
// auto-expands.

export default function HubHomeV2({ onFindTeams }: { onFindTeams: () => void }) {
  const [teams, setTeams] = useState<TrackedTeam[]>([]);
  const [games, setGames] = useState<TeamGame[]>([]);
  const [selected, setSelected] = useState<string | null>(null); // team detail drill
  const [division, setDivision] = useState<{ id: string; name: string } | null>(null);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [touched, setTouched] = useState(false); // has the user manually toggled? (stop auto-expand fighting them)

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

  const ranked = useMemo(() => rankTeams(teams, games), [teams, games]);
  const hero = mostUrgent(ranked);
  // one standings poll per unique division, shared by every card (no per-card fetch fan-out)
  const divisionIds = useMemo(() => teams.map((t) => t.divisionId), [teams]);
  const getDivision = useDivisionStandings(divisionIds);
  const model = useMemo(() => buildMyTeamsModel(teams, games), [teams, games]);
  const liveNow = ranked.filter((r) => r.kind === "live").length;
  const todayCount = ranked.filter((r) => r.kind === "live" || r.kind === "today").length;
  const liveKey = ranked.find((r) => r.kind === "live")?.team.teamKey ?? null;

  // smart default: most-urgent expanded (covers the one-team case = its card open). Don't override
  // a manual choice.
  useEffect(() => {
    if (!touched && ranked[0]) setExpandedKey(ranked[0].team.teamKey);
  }, [ranked, touched]);
  // live-promotion: a team going live floats top AND auto-expands (overrides, even if touched).
  useEffect(() => {
    if (liveKey) { setExpandedKey(liveKey); setTouched(false); }
  }, [liveKey]);

  // ── drill-downs (one level: team detail / full division) ──
  const sel = selected ? teams.find((t) => t.teamKey === selected) : null;
  if (sel) return <TeamDetail team={sel} games={games} onBack={() => setSelected(null)} />;
  if (division) {
    return (
      <div className="as-fade-in px-[18px] pt-[14px]">
        <button type="button" onClick={() => setDivision(null)} className="as-press mb-3 font-[var(--font-mono)] text-[12.6px] text-[#374151]">‹ Home</button>
        <DivisionStandings divisionId={division.id} divisionName={division.name} />
      </div>
    );
  }

  return (
    <div className="as-fade-in pb-6">
      {/* header */}
      <div className="px-[18px] pb-1 pt-[14px]">
        <h2 className="font-[var(--font-display)] text-[24.2px] font-bold text-[#1A1D23]">Home</h2>
        <div className="mt-0.5 font-[var(--font-mono)] text-[12.1px] text-[#4B5563]">
          {teams.length ? (
            <>{teams.length} tracked{model.totalRecord ? <> · <span className="font-semibold text-[#374151]">{model.totalRecord.w}–{model.totalRecord.l}</span> overall</> : null}</>
          ) : "your weekend, handled"}
        </div>
      </div>

      {/* ZONE 1 — hero (fixed, urgency-selected) */}
      <div className="mx-[18px] mt-[10px]"><HeroSlot u={hero} onSearch={onFindTeams} /></div>

      {/* ZONE 2 — status strip (only with teams) */}
      {teams.length > 0 && (
        <div className="mx-[18px] mt-[12px]"><StatusStrip liveNow={liveNow} today={todayCount} toAdvance={null} /></div>
      )}

      {/* ZONE 3 — per-team accordion stack (urgency-sorted) */}
      {ranked.length > 0 && (
        <div className="mx-[18px] mt-[14px] space-y-[10px]">
          {ranked.map((u) => (
            <TeamAccordionCard
              key={u.team.teamKey}
              u={u}
              division={getDivision(u.team.divisionId)}
              expanded={expandedKey === u.team.teamKey}
              onToggle={() => { setTouched(true); setExpandedKey((k) => (k === u.team.teamKey ? null : u.team.teamKey)); }}
              onOpenTeam={() => setSelected(u.team.teamKey)}
              onOpenDivision={() => setDivision({ id: u.team.divisionId, name: u.team.divisionName || u.team.program })}
            />
          ))}
        </div>
      )}

      {/* gated sections (Film stays guardian-gated — H9) */}
      <div className="mt-5"><HomeGatedSections teamCount={teams.length} /></div>
    </div>
  );
}
