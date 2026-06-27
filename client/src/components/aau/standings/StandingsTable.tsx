import { Check } from "lucide-react";
import type { RankedRow } from "@/lib/standings/computeStandings";

/**
 * Division/pool standings table — best-in-class render 05. Rule-driven rows from the
 * engine; the "advance to bracket" line is drawn after rank `advanceCount`; the focus
 * team is tinted cobalt. `capLabel` (e.g. "cap +20") shows when the circuit caps the
 * differential. Tokens are the best-in-class palette (§1, do not eyeball).
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

const HAIR = "border-[rgba(0,0,0,0.06)]";

export default function StandingsTable({ title, subtitle, rows, advanceCount, capLabel, focusId, footNote }: Props) {
  return (
    <div className="overflow-hidden rounded-[16px] border border-[rgba(0,0,0,0.06)] border-t-[rgba(0,0,0,0.10)] bg-[linear-gradient(180deg,#F9FAFB,#FFFFFF)]">
      <div className="flex items-center justify-between px-4 pb-2.5 pt-3.5">
        <div>
          <div className="font-[var(--font-display)] text-[15px] font-semibold text-[#1A1D23]">{title}</div>
          {subtitle && <div className="mt-0.5 text-[11px] text-[#6B7280]">{subtitle}</div>}
        </div>
        {capLabel && (
          <span className="rounded-[7px] border border-[rgba(246,204,85,0.22)] bg-[rgba(246,204,85,0.08)] px-2 py-[3px] font-[var(--font-mono)] text-[10px] text-[#8F6708]">
            {capLabel}
          </span>
        )}
      </div>
      <table className="w-full border-collapse">
        <thead>
          <tr className="font-[var(--font-mono)] text-[9px] uppercase tracking-wide text-[#6B7280]">
            <th className={`border-b ${HAIR} px-3 py-2 text-left`} colSpan={2}>Team</th>
            <th className={`border-b ${HAIR} px-3 py-2 text-right`}>W–L</th>
            <th className={`border-b ${HAIR} px-3 py-2 text-right`}>DIFF*</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <FragmentRow key={r.id} r={r} i={i} focusId={focusId} advanceCount={advanceCount} />
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={4} className="px-3 py-6 text-center text-[12px] text-[#6B7280]">
                No games on the board yet — standings appear as the tournament plays.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {footNote && (
        <div className={`flex items-center gap-1.5 border-t ${HAIR} px-3 py-2 font-[var(--font-mono)] text-[9.5px] text-[#6B7280]`}>
          <Check className="h-2.5 w-2.5 shrink-0 text-[#16A34A]" /> {footNote}
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
  const cell = "border-t border-[rgba(0,0,0,0.06)] px-3 py-3 font-[var(--font-mono)] text-[13px]";
  return (
    <>
      <tr className={me ? "bg-[rgba(95,160,230,0.10)]" : ""}>
        <td className={`w-[18px] ${cell} text-right text-[#6B7280]`}>{r.rank}</td>
        <td className={`border-t border-[rgba(0,0,0,0.06)] px-3 py-3 text-left text-[13px] font-semibold ${me ? "text-[#bcd8f3]" : "text-[#1A1D23]"}`}>{r.name}</td>
        <td className={`${cell} text-right text-[#1A1D23]`}>{wl}</td>
        <td className={`${cell} text-right text-[#1A1D23]`}>{diff}</td>
      </tr>
      {showAdvanceLine && (
        <tr>
          <td colSpan={4} className="p-0">
            <div className="flex items-center gap-2 bg-[rgba(94,203,143,0.07)] px-3 py-[6px] font-[var(--font-mono)] text-[9px] uppercase tracking-[0.07em] text-[#16A34A]">
              ▲ top {advanceCount} advance to bracket<span className="h-px flex-1 bg-[rgba(94,203,143,0.3)]" />
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
