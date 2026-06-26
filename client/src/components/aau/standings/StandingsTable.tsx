import { Check } from "lucide-react";
import type { RankedRow } from "@/lib/standings/computeStandings";

/**
 * Division/pool standings table (R2 render). Rule-driven rows from the engine; the
 * "advance to bracket" line is drawn after rank `advanceCount`; the focus team is tinted.
 * `capLabel` (e.g. "cap +20") shows when the circuit caps the differential.
 */
interface Props {
  title: string;
  subtitle?: string;
  rows: RankedRow[];
  advanceCount: number | null;
  capLabel?: string | null;
  focusId?: string | null;
  footNote?: string | null;
}

export default function StandingsTable({ title, subtitle, rows, advanceCount, capLabel, focusId, footNote }: Props) {
  return (
    <div className="overflow-hidden rounded-xl border border-[#222a39] bg-[#131825]">
      <div className="flex items-center justify-between px-4 pb-2.5 pt-3">
        <div>
          <div className="font-[var(--font-display)] text-[15px] font-semibold text-[#eef1f8]">{title}</div>
          {subtitle && <div className="mt-0.5 text-[11px] text-[#6b7488]">{subtitle}</div>}
        </div>
        {capLabel && (
          <span className="rounded-md border border-[rgba(246,204,85,0.2)] bg-[rgba(246,204,85,0.08)] px-2 py-[3px] font-[var(--font-mono)] text-[10px] text-[#F6CC55]">
            {capLabel}
          </span>
        )}
      </div>
      <table className="w-full border-collapse">
        <thead>
          <tr className="font-[var(--font-mono)] text-[9px] uppercase tracking-wide text-[#6b7488]">
            <th className="border-t border-[#222a39] px-3 py-1.5 text-left" colSpan={2}>Team</th>
            <th className="border-t border-[#222a39] px-3 py-1.5 text-right">W–L</th>
            <th className="border-t border-[#222a39] px-3 py-1.5 text-right">DIFF*</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <FragmentRow key={r.id} r={r} i={i} focusId={focusId} advanceCount={advanceCount} />
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={4} className="px-3 py-6 text-center text-[12px] text-[#6b7488]">
                No games on the board yet — standings appear as the tournament plays.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {footNote && (
        <div className="flex items-center gap-1.5 border-t border-[#222a39] px-3 py-1.5 font-[var(--font-mono)] text-[9.5px] text-[#6b7488]">
          <Check className="h-2.5 w-2.5 text-[#54c98a]" /> {footNote}
        </div>
      )}
    </div>
  );
}

function FragmentRow({ r, i, focusId, advanceCount }: { r: RankedRow; i: number; focusId?: string | null; advanceCount: number | null }) {
  const me = focusId && r.id === focusId;
  const wl = `${r.wins}–${r.losses}${r.ties ? `–${r.ties}` : ""}`;
  const diff = `${r.diff > 0 ? "+" : ""}${r.diff}`;
  const showAdvanceLine = advanceCount != null && i + 1 === advanceCount;
  return (
    <>
      <tr className={me ? "bg-[rgba(74,143,212,0.09)]" : ""}>
        <td className="w-[18px] border-t border-[#222a39] px-3 py-2.5 text-right font-[var(--font-mono)] text-[12.5px] text-[#6b7488]">{r.rank}</td>
        <td className={`border-t border-[#222a39] px-3 py-2.5 text-left text-[13px] font-semibold ${me ? "text-[#bcd8f3]" : "text-[#eef1f8]"}`}>{r.name}</td>
        <td className="border-t border-[#222a39] px-3 py-2.5 text-right font-[var(--font-mono)] text-[12.5px] text-[#eef1f8]">{wl}</td>
        <td className="border-t border-[#222a39] px-3 py-2.5 text-right font-[var(--font-mono)] text-[12.5px] text-[#eef1f8]">{diff}</td>
      </tr>
      {showAdvanceLine && (
        <tr>
          <td colSpan={4} className="p-0">
            <div className="flex items-center gap-2 bg-[rgba(84,201,138,0.06)] px-3 py-[5px] font-[var(--font-mono)] text-[9.5px] uppercase tracking-wide text-[#54c98a]">
              ▲ top {advanceCount} advance to bracket<span className="h-px flex-1 bg-[rgba(84,201,138,0.3)]" />
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
