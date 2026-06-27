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

const STATUS_LABEL: Record<string, string> = {
  clinched: "Clinched a bracket spot", eliminated: "Eliminated from the bracket",
  in: "In the bracket", out: "Out of the bracket", live: "In control",
};

// best-in-class surface: gradient card + top-hairline highlight + odds glow
const CARD =
  "overflow-hidden rounded-[18px] border border-[rgba(255,255,255,0.055)] border-t-[rgba(255,255,255,0.09)] " +
  "bg-[radial-gradient(280px_140px_at_18%_0%,rgba(232,144,42,0.10),transparent),linear-gradient(180deg,#151b29,#10141f)]";

export default function BracketOdds({ teamName, prediction: p }: Props) {
  if (!p.available) {
    return (
      <div className="rounded-[16px] border border-[rgba(255,255,255,0.055)] bg-[linear-gradient(180deg,#151b29,#10141f)] p-4 text-[12px] text-[#5f6981]">
        Bracket odds appear once this division's advancement rule is confirmed.
      </div>
    );
  }
  // No games played and nothing differentiates the field (no history, no grade gap) —
  // a precise % would be a coin-flip in disguise. Say so instead of faking confidence.
  if (p.basis === "even") {
    return (
      <div className="rounded-[16px] border border-[rgba(255,255,255,0.055)] bg-[linear-gradient(180deg,#151b29,#10141f)] p-4 text-[12px] text-[#5f6981]">
        Odds appear once games tip off — there's no result or prior history to project from yet.
      </div>
    );
  }
  const projected = p.basis === "ratings"; // no games here yet; a strength/grade projection
  const pct = Math.max(0, Math.min(100, p.oddsPct ?? 0));
  return (
    <div className={CARD}>
      <div className="flex items-center gap-4 p-4">
        {/* conic gauge — gold-gradient sweep + gold glow (best-in-class) */}
        <div
          className="relative grid h-[84px] w-[84px] shrink-0 place-items-center rounded-full"
          style={{
            background: `conic-gradient(from -90deg, #E0631C 0%, #F6CC55 ${pct}%, #232a39 ${pct}% 100%)`,
            filter: "drop-shadow(0 0 14px rgba(246,204,85,0.25))",
          }}
        >
          <span className="absolute inset-[8px] rounded-full bg-[linear-gradient(180deg,#151b29,#10141f)]" />
          <span
            className="relative font-[var(--font-mono)] text-[22px] font-bold"
            style={{ background: "var(--brand-grad)", WebkitBackgroundClip: "text", backgroundClip: "text", WebkitTextFillColor: "transparent" }}
          >
            {pct}%
          </span>
        </div>
        <div className="flex-1">
          <div className="text-[12px] text-[#9aa4ba]">Bracket odds</div>
          <div className="mt-[3px] font-[var(--font-display)] text-[18px] font-bold text-[#f0f3fa]">
            {STATUS_LABEL[p.status ?? "live"] ?? teamName}
          </div>
          <div className="mt-1 font-[var(--font-mono)] text-[10.5px] text-[#5f6981]">
            {p.decided ? "final" : projected ? "projected · no games played yet" : `${p.advancing} of ${p.outcomes} outcomes advance`}
          </div>
        </div>
      </div>

      {p.scenarios && p.scenarios.length > 0 && (
        <div className="border-t border-[rgba(255,255,255,0.055)] px-4 py-2">
          {p.scenarios.map((s, i) => {
            // Honest 3-state: in = green check, out = red x, maybe = neutral gold
            // dash (conditional — NOT a guaranteed-in green check). The predictor
            // doesn't flatter.
            const tone =
              s.kind === "out"
                ? { cls: "bg-[rgba(255,107,94,0.14)] text-[#ff6b5e]", Icon: X }
                : s.kind === "maybe"
                  ? { cls: "bg-[rgba(246,204,85,0.14)] text-[#F6CC55]", Icon: Minus }
                  : { cls: "bg-[rgba(94,203,143,0.16)] text-[#5ecb8f]", Icon: Check };
            return (
              <div key={i} className="flex items-start gap-2.5 py-2 text-[12.5px] text-[#f0f3fa]">
                <span className={`mt-px grid h-[18px] w-[18px] shrink-0 place-items-center rounded-[6px] ${tone.cls}`}>
                  <tone.Icon className="h-[11px] w-[11px]" />
                </span>
                <div>{s.text}</div>
              </div>
            );
          })}
        </div>
      )}

      <div className="flex items-center gap-[7px] border-t border-[rgba(255,255,255,0.055)] px-4 pb-[14px] pt-[10px] font-[var(--font-mono)] text-[10px] leading-[1.4] text-[#5f6981]">
        <Check className="h-[11px] w-[11px] shrink-0 text-[#5ecb8f]" />
        {projected
          ? "Projected from cross-tournament strength · wording AI"
          : "Odds enumerated exactly, weighted by team strength · wording AI"}
      </div>
    </div>
  );
}
