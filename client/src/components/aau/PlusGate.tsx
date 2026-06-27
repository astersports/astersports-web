import { X, Check, Sparkles } from "lucide-react";
import { C } from "./find/findUi";

// Aster Plus — the paywall GATE, reached from a paid action (North Star §1: Plus is a gate, not a
// destination tab). $20/mo PER ACCOUNT (one account, every kid, every team), annual $200. This is
// COSMETIC billing UI only — pricing copy + layout (routine per astersports-web §2.4). It does NOT
// wire checkout: the live billing / is_entitled money path stays owner-applied (North Star §6 gate
// #1). The CTA is intentionally inert here; wiring Stripe is a separate owner-gated step.
//
// Reachability: any component fires `window.dispatchEvent(new Event(GO_PLUS_EVENT))` to open it
// (mirrors the existing TRACKED_EVENT window-event pattern — no prop threading through the tree).

export const GO_PLUS_EVENT = "aau:go-plus";

const FEATURES = [
  "Leave-by, directions & game-time weather",
  "Schedule-change alerts, conflicts & split-up",
  "Saturday-night bracket scenarios",
];

export default function PlusGate({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center"
      style={{ background: "rgba(8,11,20,.72)", backdropFilter: "blur(8px)" }}
      onClick={onClose}
    >
      <div
        className="as-fade-in w-full max-w-[440px] rounded-t-[22px] p-[18px] sm:rounded-[22px]"
        style={{ border: "1px solid rgba(246,204,85,.3)", background: "linear-gradient(165deg,rgba(246,204,85,.08),#0d1322 60%)", boxShadow: "0 -10px 50px -20px rgba(0,0,0,.8)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <span className="inline-flex items-center gap-[6px] font-[var(--font-mono)] text-[10px] uppercase tracking-[0.1em]" style={{ color: C.g3 }}>
            <Sparkles className="h-[13px] w-[13px]" /> Aster Plus
          </span>
          <button type="button" onClick={onClose} aria-label="Close" className="as-press grid h-8 w-8 place-items-center rounded-full" style={{ border: `1px solid ${C.hair2}`, color: C.mut }}>
            <X className="h-[14px] w-[14px]" />
          </button>
        </div>

        <div className="mt-[12px] text-center">
          <div className="font-[var(--font-display)] text-[30px] font-bold tracking-[-0.02em]">
            <span className="bg-[linear-gradient(95deg,#E8902A,#F6CC55,#FBD56B)] bg-clip-text text-transparent">$20</span>
            <span className="text-[15px]" style={{ color: C.dim }}>/mo</span>
          </div>
          <div className="font-[var(--font-mono)] text-[10.5px] uppercase tracking-[0.06em]" style={{ color: C.mut }}>Per account — not per kid, not per team</div>
          <div className="mt-[4px] font-[var(--font-display)] text-[14px] font-semibold" style={{ color: C.ink }}>One account. Every kid, every team.</div>
        </div>

        <div className="mt-[14px] space-y-[8px]">
          {FEATURES.map((f) => (
            <div key={f} className="flex items-start gap-[9px] text-[12px] leading-[1.4]" style={{ color: C.dim }}>
              <Check className="mt-[1px] h-[14px] w-[14px] shrink-0" style={{ color: C.pos }} /> {f}
            </div>
          ))}
          <div className="flex items-start gap-[9px] text-[12px] leading-[1.4]" style={{ color: C.mut }}>
            <span className="mt-[1px] shrink-0 font-bold" style={{ color: "#a78bfa" }}>◆</span> Film + AI review — verified, when it ships
          </div>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="as-press mt-[16px] flex min-h-[46px] w-full items-center justify-center rounded-[12px] font-[var(--font-display)] text-[14px] font-bold"
          style={{ background: C.grad, color: "#1a1206" }}
        >
          Start Aster Plus
        </button>
        <div className="mt-[8px] text-center text-[10px]" style={{ color: C.mut }}>
          Annual $200 · cancel anytime · Browse, Live &amp; public pages stay free.
        </div>
        <div className="mt-[6px] text-center font-[var(--font-mono)] text-[9px]" style={{ color: C.faint }}>
          Checkout activates once billing is wired — it&apos;s owner-applied.
        </div>
      </div>
    </div>
  );
}
