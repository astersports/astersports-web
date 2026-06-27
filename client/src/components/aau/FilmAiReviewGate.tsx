import { Lock, ShieldCheck } from "lucide-react";
import { C } from "./find/findUi";

// Film · North Star pre-gate framing (aau-hub-northstar-render frames 04–05). Film highlights and
// the AI review are GATED on guardian verification + the TECH-2 video model (child-data gate, §6:
// auto mode never exposes minors). This card renders the HONEST pre-gate state: it describes the
// jersey-not-face / consent-and-deletion / grounded-AI-review story and the verification it takes —
// it does NOT fabricate an analysis of any specific child, and wires no new child exposure. It sits
// above the existing film room as the forward-looking, gate-honest framing.

export default function FilmAiReviewGate() {
  return (
    <div className="mb-4 space-y-3">
      {/* guardian-verification gate */}
      <div className="flex items-start gap-[11px] rounded-[14px] p-[13px]" style={{ border: `1px solid ${C.hair2}`, background: "linear-gradient(165deg,rgba(167,139,250,.08),rgba(255,255,255,0.7))" }}>
        <div className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-full" style={{ border: "2px solid #a78bfa", color: "#a78bfa" }}>
          <Lock className="h-[15px] w-[15px]" />
        </div>
        <div>
          <div className="font-[var(--font-display)] text-[13.5px] font-bold" style={{ color: C.ink }}>Verified-guardian film, with AI review</div>
          <div className="mt-[3px] text-[11.5px] leading-[1.5]" style={{ color: C.dim }}>
            Highlights involve minors, so the full film room — per-kid reels, AI-tagged moments, and the play-by-play review — unlocks only for a <span style={{ color: "#a78bfa", fontWeight: 600 }}>verified guardian</span>, with consent and one-tap deletion built in.
          </div>
        </div>
      </div>

      {/* what the AI review is — grounded, jersey-not-face */}
      <div className="rounded-[14px] p-[13px]" style={{ border: "1px solid rgba(167,139,250,.28)", background: "linear-gradient(165deg,rgba(167,139,250,.08),rgba(255,255,255,0.7))" }}>
        <span className="inline-flex items-center gap-[6px] rounded-[6px] px-[7px] py-[2px] font-[var(--font-mono)] text-[9px] font-bold tracking-[0.1em]" style={{ color: "#a78bfa", border: "1px solid rgba(167,139,250,.4)" }}>
          ◆ AI REVIEW · GROUNDED
        </span>
        <div className="mt-[8px] font-[var(--font-display)] text-[13px] font-bold" style={{ color: C.ink }}>It reviews the footage — it never invents it</div>
        <div className="mt-[4px] text-[11.5px] leading-[1.55]" style={{ color: C.dim }}>
          When a reel is available, the model breaks down what it can see — the steal, the transition, the left-hand finish under contact — as a development note that exists because it&apos;s in the video, not to flatter. It describes only visible on-court actions, never intent or anything off-frame.
        </div>
        <div className="mt-[10px] flex items-center gap-[7px] rounded-[10px] px-[10px] py-[8px]" style={{ background: "rgba(95,160,230,.06)", border: "1px solid rgba(95,160,230,.2)" }}>
          <ShieldCheck className="h-[14px] w-[14px] shrink-0" style={{ color: C.cobalt }} />
          <span className="text-[10.5px] leading-[1.45]" style={{ color: C.dim }}>Tracked by <span style={{ color: C.ink, fontWeight: 600 }}>jersey number, not face</span> — no facial recognition.</span>
        </div>
      </div>
    </div>
  );
}
