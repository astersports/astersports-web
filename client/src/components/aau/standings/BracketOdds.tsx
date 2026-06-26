import { Check, X } from "lucide-react";
import type { Prediction } from "@/lib/standings/predictBracket";

/**
 * Bracket-odds card (R2 render). The gauge % + every scenario are EXACT (the predictor
 * enumerates all remaining outcomes); only the wording is AI. The provenance line is
 * load-bearing — it stays visible anywhere odds appear (architect R1 build note). The
 * "Out" scenario is stated as plainly as the "In" ones — the predictor doesn't flatter.
 */
interface Props { teamName: string; prediction: Prediction }

const STATUS_LABEL: Record<string, string> = {
  clinched: "Clinched a bracket spot", eliminated: "Eliminated from the bracket",
  in: "In the bracket", out: "Out of the bracket", live: "Still in the hunt",
};

export default function BracketOdds({ teamName, prediction: p }: Props) {
  if (!p.available) {
    return (
      <div className="rounded-xl border border-[#2c3548] bg-[#171d2c] p-4 text-[12px] text-[#6b7488]">
        Bracket odds appear once this division's advancement rule is confirmed.
      </div>
    );
  }
  const pct = p.oddsPct ?? 0;
  return (
    <div className="overflow-hidden rounded-xl border border-[#2c3548] bg-[linear-gradient(180deg,rgba(232,144,42,0.06),transparent),#171d2c]">
      <div className="flex items-center gap-3.5 px-4 pb-3 pt-4">
        <div
          className="relative grid h-[74px] w-[74px] shrink-0 place-items-center rounded-full"
          style={{ background: `conic-gradient(#F6CC55 0% ${pct}%, #232a39 ${pct}% 100%)` }}
        >
          <span className="absolute inset-[7px] rounded-full bg-[#171d2c]" />
          <span
            className="relative font-[var(--font-mono)] text-[20px] font-bold"
            style={{ background: "var(--brand-grad)", WebkitBackgroundClip: "text", backgroundClip: "text", WebkitTextFillColor: "transparent" }}
          >
            {pct}%
          </span>
        </div>
        <div className="flex-1">
          <div className="text-[12px] text-[#9aa3b6]">Chance of making the bracket</div>
          <div className="mt-0.5 font-[var(--font-display)] text-[17px] font-bold text-[#eef1f8]">
            {STATUS_LABEL[p.status ?? "live"] ?? teamName}
          </div>
          <div className="mt-[3px] font-[var(--font-mono)] text-[11px] text-[#6b7488]">
            {p.decided ? "final" : `${p.advancing}/${p.outcomes} remaining outcomes advance you`}
          </div>
        </div>
      </div>

      {p.scenarios && p.scenarios.length > 0 && (
        <div className="border-t border-[#222a39] px-4 py-3">
          <div className="mb-2 font-[var(--font-mono)] text-[9.5px] uppercase tracking-wide text-[#6b7488]">What has to happen</div>
          {p.scenarios.map((s, i) => (
            <div key={i} className="flex items-start gap-2.5 py-1.5 text-[12.5px] text-[#eef1f8]">
              <span className={`mt-0.5 grid h-[18px] w-[18px] shrink-0 place-items-center rounded-[5px] ${s.kind === "out" ? "bg-[rgba(255,106,93,0.13)] text-[#ff6a5d]" : "bg-[rgba(84,201,138,0.14)] text-[#54c98a]"}`}>
                {s.kind === "out" ? <X className="h-2.5 w-2.5" /> : <Check className="h-2.5 w-2.5" />}
              </span>
              <div>{s.text}</div>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center gap-1.5 border-t border-[#222a39] px-4 pb-3.5 pt-2.5 font-[var(--font-mono)] text-[10.5px] text-[#6b7488]">
        <Check className="h-3 w-3 text-[#54c98a]" />
        Odds + every clinch line are exact — enumerated, not estimated. Wording is AI.
      </div>
    </div>
  );
}
