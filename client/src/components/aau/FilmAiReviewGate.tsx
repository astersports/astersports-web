import { Lock, ShieldCheck, Trash2, FileCheck2 } from "lucide-react";
import { C } from "./find/findUi";
import AgentConsole, { type AgentStep } from "./AgentConsole";

// The agent narrates the film-room pipeline as honest framing — privacy + consent + grounding.
// Static (no child data, nothing live): the console describes how review works, never any kid.
const FILM_STEPS: AgentStep[] = [
  { tag: "Privacy", line: "tracking by jersey, not face" },
  { tag: "Review", line: "grounded in the footage, never invented" },
  { tag: "Consent", line: "locked until a guardian verifies" },
  { tag: "Deletion", line: "one tap removes every reel" },
];

const PURPLE = "#7C3AED";

// The three guardian-controls surfaced under the gate. Described, not promised — these are the
// COPPA-grade controls the film room is built around; they exist as honest framing, not a live toggle.
const CONTROLS: { icon: typeof FileCheck2; label: string; detail: string }[] = [
  { icon: FileCheck2, label: "Consent first", detail: "Nothing of your kid loads until you verify as their guardian and opt in." },
  { icon: Trash2, label: "One-tap deletion", detail: "Remove a reel — or every reel — whenever you want. It's gone, not archived." },
  { icon: ShieldCheck, label: "Jersey, not face", detail: "Players are tracked by number. No facial recognition, ever." },
];

// Film · North Star pre-gate framing (aau-hub-northstar-render frames 04–05). Film highlights and
// the AI review are GATED on guardian verification + the TECH-2 video model (child-data gate, §6:
// auto mode never exposes minors). This card renders the HONEST pre-gate state: it describes the
// jersey-not-face / consent-and-deletion / grounded-AI-review story and the verification it takes —
// it does NOT fabricate an analysis of any specific child, and wires no new child exposure. It sits
// above the existing film room as the forward-looking, gate-honest framing.

export default function FilmAiReviewGate() {
  return (
    <div className="mb-4 space-y-3" role="region" aria-label="Verified-guardian film and AI review — locked">
      <AgentConsole label="aster-agent · film-room" verb="reviewing" status="standby" steps={FILM_STEPS} />

      {/* guardian-verification gate */}
      <div className="as-fade-in as-stagger-1 flex items-start gap-[11px] rounded-[14px] p-[13px]" style={{ border: `1px solid ${C.hair2}`, background: "linear-gradient(165deg,rgba(167,139,250,.08),rgba(255,255,255,0.7))" }}>
        <div className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-full" style={{ border: `2px solid ${PURPLE}`, color: PURPLE }}>
          <Lock className="h-[15px] w-[15px]" aria-hidden="true" />
        </div>
        <div>
          <div className="font-[var(--font-display)] text-[14.1px] font-bold" style={{ color: C.ink }}>Verified-guardian film, with AI review</div>
          <div className="mt-[3px] text-[13.2px] leading-[1.5]" style={{ color: C.dim }}>
            Highlights involve minors, so the full film room — per-kid reels, AI-tagged moments, and the play-by-play review — unlocks only for a <span style={{ color: PURPLE, fontWeight: 600 }}>verified guardian</span>, with consent and one-tap deletion built in.
          </div>
        </div>
      </div>

      {/* what the AI review is — grounded, jersey-not-face */}
      <div className="as-fade-in as-stagger-2 rounded-[14px] p-[13px]" style={{ border: "1px solid rgba(167,139,250,.28)", background: "linear-gradient(165deg,rgba(167,139,250,.08),rgba(255,255,255,0.7))" }}>
        <span className="inline-flex items-center gap-[6px] rounded-[6px] px-[7px] py-[2px] font-[var(--font-mono)] text-[11.5px] font-bold tracking-[0.1em]" style={{ color: PURPLE, border: "1px solid rgba(167,139,250,.4)" }}>
          ◆ AI REVIEW · GROUNDED
        </span>
        <div className="mt-[8px] font-[var(--font-display)] text-[15px] font-bold" style={{ color: C.ink }}>It reviews the footage — it never invents it</div>
        <div className="mt-[4px] text-[13.2px] leading-[1.55]" style={{ color: C.dim }}>
          When a reel is available, the model breaks down what it can see — the steal, the transition, the left-hand finish under contact — as a development note that exists because it&apos;s in the video, not to flatter. It describes only visible on-court actions, never intent or anything off-frame.
        </div>
        <div className="mt-[10px] flex items-center gap-[7px] rounded-[10px] px-[10px] py-[8px]" style={{ background: "rgba(201,149,46,.06)", border: "1px solid rgba(201,149,46,.2)" }}>
          <ShieldCheck className="h-[14px] w-[14px] shrink-0" style={{ color: C.g3 }} aria-hidden="true" />
          <span className="text-[12.1px] leading-[1.45]" style={{ color: C.dim }}>Tracked by <span style={{ color: C.ink, fontWeight: 600 }}>jersey number, not face</span> — no facial recognition.</span>
        </div>
      </div>

      {/* what the guardian controls — the COPPA-grade controls, surfaced as discrete promises */}
      <div className="as-fade-in as-stagger-3 rounded-[14px] p-[13px]" style={{ border: `1px solid ${C.line}`, background: C.s1 }}>
        <div className="font-[var(--font-mono)] text-[11.5px] font-bold uppercase tracking-[0.1em]" style={{ color: C.mut }}>You stay in control</div>
        <ul className="mt-[10px] space-y-[10px]">
          {CONTROLS.map(({ icon: Icon, label, detail }) => (
            <li key={label} className="flex items-start gap-[10px]">
              <span className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-[8px]" style={{ background: "rgba(124,58,237,.08)", color: PURPLE }}>
                <Icon className="h-[13px] w-[13px]" aria-hidden="true" />
              </span>
              <span className="text-[13.2px] leading-[1.45]" style={{ color: C.dim }}>
                <span className="font-semibold" style={{ color: C.ink }}>{label}.</span>{" "}{detail}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
