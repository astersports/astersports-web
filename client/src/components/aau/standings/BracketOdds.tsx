import { Check, X, Minus } from "lucide-react";
import type { Prediction } from "@/lib/standings/predictBracket";

/**
 * Bracket-odds card — best-in-class render 05 (the predictor hero). The gauge % + every
 * scenario are EXACT (the predictor enumerates all remaining outcomes); only the wording
 * is AI. The provenance line is load-bearing — it stays visible anywhere odds appear
 * (architect build note). The "Out" scenario is stated as plainly as the "In" ones — the
 * predictor doesn't flatter. Tokens are the best-in-class palette (do not eyeball, §1).
 */
interface Props { teamName: string; prediction: Prediction }

// Decided (final) labels by status. The live card labels from POSTURE, which tracks the math, so the
// badge can never say "In control" for a 0-2 must-win team (architect odds-review 2A).
const STATUS_LABEL: Record<string, string> = {
  clinched: "Clinched a bracket spot", eliminated: "Eliminated from the bracket",
  in: "In the bracket", out: "Out of the bracket",
};
const POSTURE_LABEL: Record<string, string> = {
  clinched: "Clinched a bracket spot",
  win_and_in: "Win and in", // controls own fate
  in_control: "In control", // a win clinches and a loss doesn't kill you
  must_win: "Must win", // alive only by winning
  needs_help: "On the brink", // can't control it
  eliminated: "Eliminated from the bracket",
};

// best-in-class surface: gradient card + top-hairline highlight + odds glow
const CARD =
  "overflow-hidden rounded-[18px] border border-[rgba(0,0,0,0.06)] border-t-[rgba(0,0,0,0.10)] " +
  "bg-[radial-gradient(280px_140px_at_18%_0%,rgba(232,144,42,0.10),transparent),linear-gradient(180deg,#F9FAFB,#FFFFFF)]";

export default function BracketOdds({ teamName, prediction: p }: Props) {
  if (!p.available) {
    return (
      <div className="rounded-[16px] border border-[rgba(0,0,0,0.06)] bg-[linear-gradient(180deg,#F9FAFB,#FFFFFF)] p-4 text-[13.8px] text-[#4B5563]">
        Bracket odds appear once this division's advancement rule is confirmed.
      </div>
    );
  }
  // No games played and nothing differentiates the field (no history, no grade gap) —
  // a precise % would be a coin-flip in disguise. Say so instead of faking confidence.
  if (p.basis === "even") {
    return (
      <div className="rounded-[16px] border border-[rgba(0,0,0,0.06)] bg-[linear-gradient(180deg,#F9FAFB,#FFFFFF)] p-4 text-[13.8px] text-[#4B5563]">
        Odds appear once games tip off — there's no result or prior history to project from yet.
      </div>
    );
  }
  const projected = p.basis === "ratings"; // no games here yet; a strength/grade projection
  // EXACT fraction of remaining scenarios in which the team advances — independent of the strength
  // weighting. We LEAD with this count; the team-strength-weighted oddsPct is SUPPRESSED until A4
  // calibration earns it (architect odds-review 2B: count is exact + confident, % is the estimate).
  const exactPct = p.outcomes ? Math.round(((p.advancing ?? 0) / p.outcomes) * 100) : 0;
  const label = p.decided
    ? STATUS_LABEL[p.status ?? "in"] ?? teamName
    : POSTURE_LABEL[p.posture ?? "needs_help"] ?? teamName;
  const countLine = p.decided
    ? "final"
    : `advances in ${p.advancing} of ${p.outcomes} remaining scenario${p.outcomes === 1 ? "" : "s"}`;
  return (
    <div className={CARD}>
      <div className="flex items-center gap-4 p-4">
        {/* conic gauge — filled by the EXACT advancing fraction (not the suppressed weighted %) */}
        <div
          role="img"
          aria-label={p.decided ? `${label} — ${exactPct}% of scenarios` : `Advances in ${p.advancing} of ${p.outcomes} remaining scenarios`}
          className="relative grid h-[84px] w-[84px] shrink-0 place-items-center rounded-full"
          style={{
            background: `conic-gradient(from -90deg, #E0631C 0%, #F6CC55 ${exactPct}%, #E2E8F0 ${exactPct}% 100%)`,
            filter: "drop-shadow(0 0 14px rgba(246,204,85,0.25))",
          }}
        >
          <span className="absolute inset-[8px] rounded-full bg-[linear-gradient(180deg,#F9FAFB,#FFFFFF)]" aria-hidden />
          <span
            aria-hidden
            className="relative font-[var(--font-mono)] text-[17.3px] font-bold leading-none"
            style={{ background: "var(--brand-grad)", WebkitBackgroundClip: "text", backgroundClip: "text", WebkitTextFillColor: "transparent" }}
          >
            {p.decided ? `${exactPct}%` : `${p.advancing}/${p.outcomes}`}
          </span>
        </div>
        <div className="flex-1">
          <div className="text-[13.8px] text-[#374151]">Advancement</div>
          <div className="mt-[3px] font-[var(--font-display)] text-[20.7px] font-bold text-[#1A1D23]">
            {label}
          </div>
          <div className="mt-1 font-[var(--font-mono)] text-[12.1px] text-[#4B5563]">
            {projected ? `projected · ${countLine} (no games yet)` : countLine}
          </div>
        </div>
      </div>

      {p.scenarios && p.scenarios.length > 0 && (
        <div className="border-t border-[rgba(0,0,0,0.06)] px-4 py-2">
          {p.scenarios.map((s, i) => {
            // Honest 3-state: in = green check, out = red x, maybe = neutral gold
            // dash (conditional — NOT a guaranteed-in green check). The predictor
            // doesn't flatter.
            const tone =
              s.kind === "out"
                ? { cls: "bg-[rgba(255,107,94,0.14)] text-[#DC2626]", Icon: X }
                : s.kind === "maybe"
                  ? { cls: "bg-[rgba(246,204,85,0.14)] text-[#8F6708]", Icon: Minus }
                  : { cls: "bg-[rgba(94,203,143,0.16)] text-[#16A34A]", Icon: Check };
            return (
              <div key={i} className="flex items-start gap-2.5 py-2 text-[14.4px] text-[#1A1D23]">
                <span className={`mt-px grid h-[18px] w-[18px] shrink-0 place-items-center rounded-[6px] ${tone.cls}`}>
                  <tone.Icon className="h-[11px] w-[11px]" />
                </span>
                <div>{s.text}</div>
              </div>
            );
          })}
        </div>
      )}

      <div className="flex items-center gap-[7px] border-t border-[rgba(0,0,0,0.06)] px-4 pb-[14px] pt-[10px] font-[var(--font-mono)] text-[11.5px] leading-[1.4] text-[#4B5563]">
        <Check className="h-[11px] w-[11px] shrink-0 text-[#16A34A]" />
        {projected
          ? "Projected from cross-tournament strength · wording AI"
          : "Outcomes enumerated exactly · wording AI"}
      </div>
    </div>
  );
}
