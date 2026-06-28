import { Moon, Bell, Sparkles } from "lucide-react";
import { C } from "./find/findUi";
import { GO_PLUS_EVENT } from "./PlusGate";

// Home's gated capabilities, rendered in their HONEST pre-gate state (North Star §0: build the
// shell now; every gated capability shows its honest pre-gate state and lights up at its gate;
// nothing is faked). Two cards:
//   • What-changed (§2.D schedule-diff feed) — not built yet → an honest "we'll watch & alert"
//     note, never a fabricated diff.
//   • Saturday-night predictive model (§2.B bracket data + F1 calibration) — exact clinch / if-then
//     CONDITIONS land when the bracket data does; the make-the-bracket % stays "—" until the model
//     calibrates on real results. No number appears before it earns it.
// Both only render when the user actually tracks teams (otherwise they're noise on an empty hub).

/** Honest pre-gate status chip — these capabilities aren't faked, they light up at their gate.
 *  Naming the state ("Watching", "At its gate") tells the user the absence is intentional. */
function GatePill() {
  return (
    <span
      className="shrink-0 rounded-full px-[8px] py-[2px] font-[var(--font-mono)] text-[11.5px] font-semibold uppercase tracking-[0.08em]"
      style={{ border: `1px solid ${C.hair2}`, background: "rgba(0,0,0,0.03)", color: C.mut }}
    >
      At its gate
    </span>
  );
}

export default function HomeGatedSections({ teamCount }: { teamCount: number }) {
  if (teamCount === 0) return null;
  return (
    <div className="mt-5 space-y-3 px-[18px]">
      {/* what-changed — gated on the §2.D diff feed */}
      <div className="flex items-start gap-[9px] rounded-[13px] px-[12px] py-[11px]" style={{ border: `1px solid ${C.hair2}`, background: "rgba(95,160,230,.05)" }}>
        <Bell className="mt-[1px] h-[15px] w-[15px] shrink-0" style={{ color: C.cobalt }} aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <div className="font-[var(--font-display)] text-[14.4px] font-semibold" style={{ color: C.ink }}>Schedule-change watch</div>
            <GatePill />
          </div>
          <div className="mt-[2px] text-[13.2px] leading-[1.5]" style={{ color: C.mut }}>
            When a tracked game moves court or time, it shows here as a diff and your leave-by re-computes — the moment the bracket re-posts.
          </div>
        </div>
      </div>

      {/* Saturday-night predictive model — gated on §2.B bracket data + F1 calibration */}
      <div className="overflow-hidden rounded-[16px] p-[14px]" style={{ border: "1px solid rgba(167,139,250,.24)", background: "linear-gradient(165deg,rgba(167,139,250,.10),rgba(255,255,255,0.7))" }}>
        <div className="flex items-center justify-between">
          <span className="font-[var(--font-mono)] text-[11.5px] uppercase tracking-[0.12em]" style={{ color: "#7C3AED" }}>Saturday night · the bracket</span>
          <span className="flex items-center gap-[7px]">
            <GatePill />
            <Moon className="h-[14px] w-[14px]" style={{ color: "#7C3AED" }} aria-hidden />
          </span>
        </div>
        <div className="mt-[7px] font-[var(--font-display)] text-[16.7px] font-bold" style={{ color: C.ink }}>What it takes to make Sunday</div>
        <div className="mt-[5px] text-[13.8px] leading-[1.55]" style={{ color: C.dim }}>
          When pool play wraps, you&apos;ll see exactly what each team needs — <span style={{ color: "#16A34A", fontWeight: 600 }}>clinched</span>, <span style={{ color: "#DC2626", fontWeight: 600 }}>out</span>, or the if/then (&ldquo;win 9:00 and you clinch the 4-seed&rdquo;). The conditions are exact math.
        </div>
        <div className="mt-[11px] flex items-center justify-between rounded-[11px] px-[11px] py-[9px]" style={{ background: "rgba(0,0,0,0.03)", border: `1px solid ${C.hair}` }}>
          <span className="font-[var(--font-mono)] text-[12.1px]" style={{ color: C.mut }}>Make the bracket</span>
          <span className="font-[var(--font-display)] text-[17.3px] font-bold" style={{ color: C.faint }}>—</span>
        </div>
        <div className="mt-[6px] text-[11.5px] italic leading-[1.5]" style={{ color: C.mut }}>
          The likelihood is a calibrated estimate — suppressed until the model earns it on real tournament results. A clinched team never shows a probability.
        </div>
        <button
          type="button"
          onClick={() => window.dispatchEvent(new Event(GO_PLUS_EVENT))}
          aria-label="Unlock the Saturday-night bracket predictor with Aster Plus"
          className="as-press mt-[11px] flex min-h-[44px] w-full items-center justify-center gap-[6px] rounded-[10px] py-[9px] font-[var(--font-display)] text-[13.8px] font-bold"
          style={{ background: C.grad, color: "#1a1206" }}
        >
          <Sparkles className="h-[13px] w-[13px]" aria-hidden /> Unlock with Aster Plus
        </button>
      </div>
    </div>
  );
}
