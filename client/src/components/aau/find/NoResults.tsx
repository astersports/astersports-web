import { Search, Link2, Bell } from "lucide-react";
import { C } from "./findUi";

// Render state 05 — first-class no-results state (spec §4 NO-RESULTS / §5 copy). NO fabricated
// near-match: searchPublicAau returns no near-match field, and teams is empty here by definition,
// so we show NO "did you mean" row rather than guess one (spec §7/§9 — never pad with fabricated
// rows). The two real ways in: paste a link, or ask us to add the tournament.

export default function NoResults({ query, onPaste, onRequest }: { query: string; onPaste: () => void; onRequest: () => void }) {
  return (
    <div className="as-fade-in">
      <div className="mx-[22px] mt-[30px] text-center">
        <div
          className="mx-auto mb-[14px] grid h-[54px] w-[54px] place-items-center rounded-[16px]"
          style={{ background: C.s2, border: `1px solid ${C.line}` }}
          aria-hidden
        >
          <Search className="h-[26px] w-[26px]" style={{ color: C.mut }} />
        </div>
        <h4 className="m-0 font-[var(--font-display)] text-[23.2px] font-semibold" style={{ color: C.ink }}>
          No team or tournament yet
        </h4>
        <p className="mx-auto mt-[7px] max-w-[280px] text-[20px] leading-[1.55]" style={{ color: C.mut }}>
          We don&apos;t have {query.trim() ? `“${query.trim()}”` : "that"} in the backbone. If you&apos;ve got the schedule link,
          paste it — we&apos;ll pull everything in.
        </p>
      </div>

      <div className="px-[18px] pt-[18px]">
        <button
          type="button"
          onClick={onPaste}
          className="as-press flex min-h-[44px] w-full items-center justify-center gap-2 rounded-[13px] border-none p-[14px] font-[var(--font-display)] text-[20.3px] font-semibold"
          style={{ background: C.grad, color: "#1a1206", boxShadow: "0 12px 28px -14px rgba(224,99,28,.6)" }}
        >
          <Link2 className="h-[16px] w-[16px]" /> Paste a tournament link
        </button>
      </div>
      <div className="px-[18px] pt-[10px]">
        <button
          type="button"
          onClick={onRequest}
          className="as-press flex min-h-[44px] w-full items-center justify-center gap-2 rounded-[13px] p-[14px] font-[var(--font-display)] text-[20.3px] font-semibold"
          style={{ background: C.s2, color: C.ink, border: `1px solid ${C.line}` }}
        >
          <Bell className="h-[16px] w-[16px]" /> Ask us to add this tournament
        </button>
      </div>

      <div className="mt-5 px-[18px] text-center font-[var(--font-mono)] text-[16px] leading-[1.5]" style={{ color: C.mut }}>
        No fabricated rows to pad an empty result — only the two real ways in.
      </div>
    </div>
  );
}
