import { Check, X, Minus } from "lucide-react";
import type { Prediction } from "@/lib/standings/predictBracket";

/**
 * BracketPath (Hub Home V2) — the exact-count advancement state for one team.
 *
 * HONESTY RULE H1 / §8 (enforced at the TYPE LEVEL): this component is structurally incapable of
 * rendering a probability. Its input OMITS `oddsPct` AND bans it (`oddsPct?: never`), so a raw
 * Prediction (which carries oddsPct) cannot be passed in — the call site must strip it first
 * (Copilot review on #208: a plain Omit only stops READING the field, not passing a value that has
 * it). Home shows exact-count state ONLY — the clinched / win-and-in / in-control / must-win /
 * on-the-bubble / out ladder + the enumerated scenario count. The posture comes from
 * predictBracket's win/lose enumeration, so a marginal team can never read "in control" (H3).
 */
export type BracketPathInput = Omit<Prediction, "oddsPct"> & { oddsPct?: never };

// Decided (final) labels by status, and the live posture ladder. Honest wording (H3): a team that
// can't control its fate reads "On the bubble", never "In control".
const STATUS_LABEL: Record<string, string> = {
  clinched: "Clinched a bracket spot",
  eliminated: "Eliminated from the bracket",
  in: "In the bracket",
  out: "Out of the bracket",
};
const POSTURE_LABEL: Record<string, string> = {
  clinched: "Clinched a bracket spot",
  win_and_in: "Win and in",
  in_control: "In control",
  must_win: "Must win",
  needs_help: "On the bubble",
  eliminated: "Eliminated from the bracket",
};

export default function BracketPath({ p }: { p: BracketPathInput }) {
  if (!p.available) {
    return (
      <div className="rounded-[12px] border border-[rgba(0,0,0,0.06)] bg-[#FFFFFF] px-3 py-2.5 font-[var(--font-mono)] text-[12.1px] text-[#4B5563]">
        Bracket path appears once this division's advancement rule is confirmed.
      </div>
    );
  }
  if (p.basis === "even") {
    return (
      <div className="rounded-[12px] border border-[rgba(0,0,0,0.06)] bg-[#FFFFFF] px-3 py-2.5 font-[var(--font-mono)] text-[12.1px] text-[#4B5563]">
        Path appears once games tip off — no result or prior history to project from yet.
      </div>
    );
  }

  const clinched = p.posture === "clinched" || p.status === "clinched" || p.status === "in";
  const eliminated = p.posture === "eliminated" || p.status === "eliminated" || p.status === "out";
  const label = p.decided
    ? STATUS_LABEL[p.status ?? "in"] ?? "In the bracket"
    : POSTURE_LABEL[p.posture ?? "needs_help"] ?? "On the bubble";
  const Icon = clinched ? Check : eliminated ? X : Minus;
  const tone = clinched
    ? { cls: "text-[#16A34A]", chip: "bg-[rgba(22,163,74,0.12)] text-[#16A34A]" }
    : eliminated
      ? { cls: "text-[#DC2626]", chip: "bg-[rgba(220,38,38,0.10)] text-[#DC2626]" }
      : { cls: "text-[#8F6708]", chip: "bg-[rgba(246,204,85,0.16)] text-[#8F6708]" };

  const count =
    p.decided || p.outcomes == null
      ? null
      : `advances in ${p.advancing} of ${p.outcomes} remaining scenario${p.outcomes === 1 ? "" : "s"}`;

  return (
    <div className="rounded-[12px] border border-[rgba(0,0,0,0.06)] bg-[#FFFFFF] p-3">
      <div className="flex items-center gap-2">
        <span className={`grid h-[20px] w-[20px] shrink-0 place-items-center rounded-[6px] ${tone.chip}`}>
          <Icon className="h-[12px] w-[12px]" aria-hidden="true" />
        </span>
        <span className={`font-[var(--font-display)] text-[14.4px] font-bold ${tone.cls}`}>{label}</span>
      </div>
      {count && <div className="mt-1.5 font-[var(--font-mono)] text-[12.1px] text-[#374151]">{count}</div>}
      <div className="mt-1.5 flex items-center gap-1.5 font-[var(--font-mono)] text-[11.5px] text-[#4B5563]">
        <Check className="h-[11px] w-[11px] shrink-0 text-[#16A34A]" aria-hidden="true" /> Outcomes enumerated exactly
      </div>
    </div>
  );
}
