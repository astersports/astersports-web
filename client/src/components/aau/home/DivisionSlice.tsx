import { Fragment } from "react";
import { ChevronRight } from "lucide-react";
import type { RankedRow } from "@/lib/standings/computeStandings";
import { sliceStandings } from "@/lib/standings/sliceStandings";

/**
 * DivisionSlice — the §5.3 sliced standings inside a Home team card. Presentational: the parent
 * card runs `useAauStandings(divisionId)` ONCE and passes the SAME rows/advanceCount Browse uses
 * (one source, no second computation) down here. We render only the focus row + cut-bracketing
 * rows + the cut marker, then deep-link to the full Browse table.
 */
interface Props {
  rows: RankedRow[];
  advanceCount: number | null;
  focusId: string | null;
  focusName: string | null;
  loading: boolean;
  onOpenFull: () => void;
}

export default function DivisionSlice({ rows, advanceCount, focusId, focusName, loading, onOpenFull }: Props) {
  if (loading && !rows.length) {
    return <div className="h-16 animate-pulse rounded-[12px] border border-[rgba(0,0,0,0.06)] bg-[#FFFFFF]/60" />;
  }
  if (!rows.length) {
    return (
      <div className="rounded-[12px] border border-[rgba(0,0,0,0.06)] bg-[#FFFFFF] px-3 py-2.5 font-[var(--font-mono)] text-[12.1px] text-[#4B5563]">
        Standings appear as this division plays.
      </div>
    );
  }
  const slice = sliceStandings(rows, focusId, advanceCount, focusName);
  const matchedId = focusId ?? slice.find((r) => focusName && r.name.trim().toLowerCase() === focusName.trim().toLowerCase())?.id ?? null;

  return (
    <div className="overflow-hidden rounded-[12px] border border-[rgba(0,0,0,0.06)] bg-[#FFFFFF]">
      <table className="w-full border-collapse">
        <tbody>
          {slice.map((r, i) => {
            const me = (matchedId != null && r.id === matchedId) || (focusName != null && r.name.trim().toLowerCase() === focusName.trim().toLowerCase());
            // cut marker sits between the last advancing rank and the first non-advancing rank shown
            const showCutBefore = advanceCount != null && r.rank > advanceCount && (i === 0 || slice[i - 1].rank <= advanceCount);
            const wl = `${r.wins}–${r.losses}${r.ties ? `–${r.ties}` : ""}`;
            const diff = `${r.diff > 0 ? "+" : ""}${r.diff}`;
            return (
              <Fragment key={r.id}>
                {showCutBefore && (
                  <tr>
                    <td colSpan={4} className="p-0">
                      <div className="flex items-center gap-2 bg-[rgba(94,203,143,0.07)] px-3 py-[5px] font-[var(--font-mono)] text-[11px] uppercase tracking-[0.07em] text-[#16A34A]">
                        ▲ top {advanceCount} advance<span className="h-px flex-1 bg-[rgba(94,203,143,0.3)]" />
                      </div>
                    </td>
                  </tr>
                )}
                <tr className={me ? "bg-[rgba(201,149,46,0.10)]" : ""}>
                  <td className="w-[20px] border-t border-[rgba(0,0,0,0.05)] px-2.5 py-2 text-right font-[var(--font-mono)] text-[12.6px] text-[#4B5563]">{r.rank}</td>
                  <td className={`border-t border-[rgba(0,0,0,0.05)] px-2 py-2 text-left text-[13.2px] font-semibold ${me ? "text-[#1d4ed8]" : "text-[#1A1D23]"}`}>
                    {r.name}{me && <span className="ml-1.5 font-[var(--font-mono)] text-[11px] font-normal text-[#1d4ed8]">← you</span>}
                  </td>
                  <td className="border-t border-[rgba(0,0,0,0.05)] px-2 py-2 text-right font-[var(--font-mono)] text-[13.2px] tabular-nums text-[#1A1D23]">{wl}</td>
                  <td className="border-t border-[rgba(0,0,0,0.05)] px-2.5 py-2 text-right font-[var(--font-mono)] text-[13.2px] tabular-nums text-[#1A1D23]">{diff}</td>
                </tr>
              </Fragment>
            );
          })}
        </tbody>
      </table>
      <button type="button" onClick={onOpenFull} className="as-press flex w-full items-center justify-end gap-1 border-t border-[rgba(0,0,0,0.06)] px-3 py-2 font-[var(--font-mono)] text-[11.5px] text-[#374151]">
        full division <ChevronRight className="h-[13px] w-[13px]" aria-hidden="true" />
      </button>
    </div>
  );
}
