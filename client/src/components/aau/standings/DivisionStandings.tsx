import { useState } from "react";
import { useAauStandings } from "@/hooks/useAauStandings";
import StandingsTable from "./StandingsTable";
import BracketOdds from "./BracketOdds";
import TeamScores from "./TeamScores";

/**
 * One division's live detail (R2): header + rule-driven standings + bracket odds for a
 * focus team. Tap a team to see its odds. All public data, read from the aster-sports
 * backbone; the engine applies the cap + tiebreakers and the predictor enumerates odds.
 */
interface Props { divisionId: string; divisionName: string }

export default function DivisionStandings({ divisionId, divisionName }: Props) {
  const { loading, error, bundle, standings, advanceCount, predictFor } = useAauStandings(divisionId);
  const [focusId, setFocusId] = useState<string | null>(null);

  const effectiveFocus = focusId ?? standings[0]?.id ?? null;
  const cap = bundle?.rules?.pointDiffCap ?? null;
  const capLabel = cap != null ? `cap +${cap}` : null;
  const circuit = bundle?.division?.circuit ?? null;
  const footNote = cap != null ? "2-way tie → head-to-head · 3-way → point differential" : null;

  if (error) {
    return <div className="rounded-[16px] border border-[rgba(0,0,0,0.06)] bg-[linear-gradient(180deg,#F9FAFB,#FFFFFF)] p-6 text-center text-[12px] text-[#4B5563]">Couldn't reach the standings. Try again in a moment.</div>;
  }
  if (loading && !bundle) {
    return <div className="h-40 animate-pulse rounded-[16px] border border-[rgba(0,0,0,0.06)] bg-[#FFFFFF]/60" />;
  }

  return (
    <div className="space-y-4">
      <div>
        <div className="font-[var(--font-display)] text-[20px] font-bold tracking-tight text-[#1A1D23]">{divisionName}</div>
        <div className="mt-1 flex flex-wrap gap-2 text-[11px]">
          {circuit && <span className="rounded-[7px] border border-[#E2E8F0] px-2 py-0.5 font-[var(--font-mono)] text-[#374151]">{circuit}</span>}
          {advanceCount != null && (
            <span className="rounded-[7px] border border-[#E2E8F0] px-2 py-0.5 font-[var(--font-mono)] text-[#374151]">top {advanceCount} → bracket</span>
          )}
          {advanceCount == null && (
            <span className="rounded-[7px] border border-[#E2E8F0] px-2 py-0.5 font-[var(--font-mono)] text-[#4B5563]">advancement TBD</span>
          )}
        </div>
      </div>

      <StandingsTable
        title="Division standings"
        subtitle={`${standings.length} teams`}
        rows={standings}
        advanceCount={advanceCount}
        capLabel={capLabel}
        focusId={effectiveFocus}
        footNote={footNote}
      />

      {standings.length > 1 && (
        <div className="flex flex-wrap gap-1.5">
          {standings.map((r) => (
            <button
              key={r.id}
              onClick={() => setFocusId(r.id)}
              className={`rounded-full border px-3 py-1.5 text-[11px] font-semibold transition-colors ${
                effectiveFocus === r.id ? "border-transparent bg-[linear-gradient(100deg,#E0631C,#E8902A,#F6CC55,#FBD56B)] text-[#1a1206]" : "border-[#E2E8F0] bg-[#F9FAFB] text-[#374151] hover:bg-[#F1F3F5]"
              }`}
            >
              {r.name}
            </button>
          ))}
        </div>
      )}

      {effectiveFocus && (
        <BracketOdds teamName={standings.find((r) => r.id === effectiveFocus)?.name ?? ""} prediction={predictFor(effectiveFocus)} />
      )}

      {/* the leaf: the focus team's REAL game scores, in context, below its odds (architect IA) */}
      {effectiveFocus && bundle && (
        <TeamScores
          focusId={effectiveFocus}
          games={bundle.games}
          nameById={new Map(standings.map((r) => [r.id, r.name]))}
        />
      )}
    </div>
  );
}
