// Hub Home V2 — Zone 2 status strip (§5). Three DERIVED counters, none predicted. TO ADVANCE is
// honestly blank during pool play (H1/H6) — it never shows an estimate; once a team's pool wraps it
// would show the exact count of clinched teams (wired when per-team postures are lifted).
interface Props {
  liveNow: number;
  today: number;
  toAdvance: number | null; // null → honest "computes when pool play wraps"
}

function Counter({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex-1 rounded-[12px] border border-[rgba(0,0,0,0.06)] bg-[#FFFFFF] px-3 py-2.5 text-center">
      <div className="font-[var(--font-mono)] text-[19px] font-bold tabular-nums text-[#1A1D23]">{value}</div>
      <div className="mt-0.5 font-[var(--font-mono)] text-[10.5px] uppercase tracking-[0.08em] text-[#4B5563]">{label}</div>
    </div>
  );
}

export default function StatusStrip({ liveNow, today, toAdvance }: Props) {
  return (
    <div>
      <div className="flex gap-[10px]" role="group" aria-label="Tracked-team summary">
        <Counter label="live now" value={String(liveNow)} />
        <Counter label="today" value={String(today)} />
        <Counter label="to advance" value={toAdvance == null ? "—" : String(toAdvance)} />
      </div>
      {toAdvance == null && (
        <div className="mt-1.5 px-1 text-center font-[var(--font-mono)] text-[11px] text-[#4B5563]">
          We'll show who's advancing once pool play wraps.
        </div>
      )}
    </div>
  );
}
