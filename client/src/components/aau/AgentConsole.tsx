import { useEffect, useState, type ReactNode } from "react";

/**
 * AgentConsole — the reusable "live Aster agent" visual language, extracted from the
 * landing FrontierSection so every surface can feel alive and on-brand. A green live-dot,
 * a monospace agent label, a scanning narration line that cycles through the surface's
 * real steps (with a gold→orange progress sweep), and a chip row where the active step
 * lights up. Theme-aware: `tone="light"` for the AAU hub (white card on the medium-gray
 * base), `tone="dark"` for the navy landing.
 *
 * No fabrication: each surface passes its OWN steps built from real state. The console is
 * a presentation of what the page already knows, narrated — not invented activity.
 * prefers-reduced-motion: no cycling (the first step stays lit), per §16.4.
 */
export interface AgentStep {
  /** short uppercase chip label, e.g. "LIVE" */
  tag: string;
  /** the narration shown when this step is active, e.g. "2 games live now" */
  line: ReactNode;
}

interface Props {
  /** mono agent label, e.g. "ASTER-AGENT · TRACKING" */
  label: string;
  /** the steps the agent cycles through (≥1) */
  steps: AgentStep[];
  /** the scanning verb, e.g. "scanning" / "computing" / "indexing" */
  verb?: string;
  /** right-aligned status word, default "live" */
  status?: string;
  /** ms between step advances */
  intervalMs?: number;
  tone?: "light" | "dark";
  className?: string;
}

export default function AgentConsole({
  label,
  steps,
  verb = "scanning",
  status = "live",
  intervalMs = 2600,
  tone = "light",
  className = "",
}: Props) {
  const [active, setActive] = useState(0);
  const n = steps.length;

  useEffect(() => {
    if (n <= 1) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return; // leave the first step lit, no cycling
    const id = window.setInterval(() => setActive((a) => (a + 1) % n), intervalMs);
    return () => window.clearInterval(id);
  }, [n, intervalMs]);

  if (!n) return null;
  const i = active % n;
  const current = steps[i];

  const light = tone === "light";
  const frame = light ? "aster-terminal--light" : "aster-terminal";
  const labelCls = light ? "text-[#6B7280]" : "text-slate-400";
  const lineCls = light ? "text-[#4B5563]" : "text-slate-300";
  const idxMuted = light ? "text-[#9CA3AF]" : "text-slate-500";
  const trackBg = light ? "bg-[rgba(0,0,0,0.02)] border-[rgba(0,0,0,0.05)]" : "bg-white/[0.02] border-white/5";
  const idleChip = light ? "aster-chip-idle--light" : "aster-chip-idle";

  return (
    <div className={`${frame} aster-scan-track p-4 ${className}`} role="status" aria-live="polite">
      <div className="mb-3 flex items-center gap-2">
        <span className="aster-dot-live" aria-hidden="true" />
        <span className={`aster-mono text-[11px] uppercase tracking-[0.14em] ${labelCls}`}>{label}</span>
        <span className="aster-mono ml-auto text-[10px] text-[#16A34A]">{status}</span>
      </div>

      <div className={`mb-3 rounded-lg border p-3.5 ${trackBg}`}>
        <div className={`aster-mono text-[12px] leading-relaxed ${lineCls}`}>
          <span className="text-[#E8902A]">▸</span> {verb} <span className={light ? "text-[#1A1D23]" : "text-white"}>{i + 1}</span>
          <span className={idxMuted}> / {n}</span> — <span className="aster-grad-text font-semibold">{current.line}</span>
        </div>
        <div className="as-progress-bar mt-3" aria-hidden="true">
          <div
            className="as-progress-fill"
            style={{
              width: `${((i + 1) / n) * 100}%`,
              background: "var(--brand-grad)",
              transition: "width .5s cubic-bezier(0.23,1,0.32,1)",
            }}
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {steps.map((s, idx) => (
          <span key={s.tag} className={idx === i ? "aster-chip-on" : idleChip}>
            {s.tag}
          </span>
        ))}
      </div>
    </div>
  );
}
