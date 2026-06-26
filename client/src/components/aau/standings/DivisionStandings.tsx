import { useState } from "react";
import { useAauStandings } from "@/hooks/useAauStandings";
import StandingsTable from "./StandingsTable";
import BracketOdds from "./BracketOdds";

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
    return <div className="rounded-xl border border-[#222a39] bg-[#131825] p-6 text-center text-[12px] text-[#6b7488]">Couldn't reach the standings. Try again in a moment.</div>;
  }
  if (loading && !bundle) {
    return <div className="h-40 animate-pulse rounded-xl border border-[#222a39] bg-[#131825]/60" />;
  }

  return (
    <div className="space-y-4">
      <div>
        <div className="font-[var(--font-display)] text-[20px] font-bold tracking-tight text-[#eef1f8]">{divisionName}</div>
        <div className="mt-1 flex flex-wrap gap-2 text-[11px]">
          {circuit && <span className="rounded-md border border-[#2c3548] px-2 py-0.5 font-[var(--font-mono)] text-[#9aa3b6]">{circuit}</span>}
          {advanceCount != null && (
            <span className="rounded-md border border-[#2c3548] px-2 py-0.5 font-[var(--font-mono)] text-[#9aa3b6]">top {advanceCount} → bracket</span>
          )}
          {advanceCount == null && (
            <span className="rounded-md border border-[#2c3548] px-2 py-0.5 font-[var(--font-mono)] text-[#6b7488]">advancement TBD</span>
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
              className={`rounded-full border px-3 py-1 text-[11px] font-semibold transition-colors ${
                effectiveFocus === r.id ? "border-[#E8902A] bg-[rgba(232,144,42,0.12)] text-[#F6CC55]" : "border-[#2c3548] bg-[#131825] text-[#9aa3b6] hover:bg-[#171d2c]"
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
    </div>
  );
}
