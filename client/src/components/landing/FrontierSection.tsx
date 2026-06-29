import { Bot, ScanSearch, Brush, Eye, Brain, Cpu, type LucideIcon } from "lucide-react";
import { useInView } from "@/hooks/useInView";
import { useScanCycle } from "@/hooks/useScanCycle";
import SpotlightCard from "./SpotlightCard";

/**
 * The live concierge chat now lives in a prominent "Ask Aster Scout" section at
 * the top of the page (see AskScoutSection in Home.tsx); this section keeps the
 * idle frontier-trends scan as the AI visual.
 */

/**
 * "The agent layer" — a frontier-trends showcase. A simulated scout agent
 * cycles through and "identifies" the next-level AI/ML techniques the studio
 * tracks, lighting up the matching trend card as it goes.
 *
 * The six trends are grounded in genuinely current (late-2025/2026) research —
 * SAM 3 promptable concept segmentation, agentic multi-agent systems,
 * diffusion-transformer inpainting, multimodal VLMs, inference-time reasoning,
 * and on-device/WebGPU edge inference — not invented capability claims. The
 * console is an illustrative visual, not a live model call.
 */
interface Trend {
  tag: string;
  name: string;
  line: string;
  icon: LucideIcon;
}

const TRENDS: Trend[] = [
  {
    tag: "Agentic AI",
    name: "Agentic workflows",
    line: "Autonomous agents that plan and run multi-step design and scheduling work — not just answer prompts.",
    icon: Bot,
  },
  {
    tag: "Segmentation",
    name: "Promptable concept segmentation",
    line: "Text or exemplar prompts mask every instance of a fabric, print, or pattern in a single pass.",
    icon: ScanSearch,
  },
  {
    tag: "Diffusion",
    name: "Generative inpainting",
    line: "Latent-diffusion fill restyles print regions photorealistically while preserving fabric texture and light.",
    icon: Brush,
  },
  {
    tag: "Multimodal",
    name: "Vision-language models",
    line: "One model reads an apparel image and its brief together to reason over print layout and intent.",
    icon: Eye,
  },
  {
    tag: "Reasoning",
    name: "Test-time compute",
    line: "Models that think longer at inference for tougher density, scale, and roster-analytics decisions.",
    icon: Brain,
  },
  {
    tag: "Edge AI",
    name: "On-device inference",
    line: "Small multimodal models run client-side for private, low-latency previews of designs and team data.",
    icon: Cpu,
  },
];

export default function FrontierSection() {
  const { ref, isVisible } = useInView<HTMLDivElement>();
  // Cycles the scanned trend; pauses under prefers-reduced-motion and reacts to
  // the user toggling it mid-session (shared with the constellation scan).
  const active = useScanCycle(TRENDS.length, isVisible, 2400);
  const current = TRENDS[active];

  return (
    <section id="frontier" className="relative py-12 md:py-20 bg-[#E6EAF0]" aria-label="AI frontier trends">
      <div className="container" ref={ref}>
        <div className="grid lg:grid-cols-[0.9fr_1.1fr] gap-10 lg:gap-14 items-start">
          {/* Left: intro + the agent scan console */}
          <div>
            <div
              className={`flex items-center gap-2 mb-4 transition-all duration-500 ${
                isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-5"
              }`}
            >
              <span className="aster-stage-chip">Agentic AI · Live frontier scan</span>
            </div>
            <h2
              className={`text-3xl md:text-4xl font-bold text-[#1c2230] tracking-tight mb-4 transition-all duration-700 delay-100 ${
                isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-5"
              }`}
              style={{ fontFamily: "var(--font-display)" }}
            >
              Agents charting <span className="aster-grad-text">what's next.</span>
            </h2>
            <p
              className={`text-[15px] md:text-base text-slate-600 leading-relaxed mb-6 transition-all duration-700 delay-200 ${
                isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-5"
              }`}
            >
              A scout agent continuously tracks the AI/ML frontier — so the techniques
              powering Studio and the platform stay a step ahead. Here's what it's
              watching right now.
            </p>

            {/* agent scan console */}
            <div
              className={`aster-terminal p-4 md:p-5 transition-all duration-700 delay-300 ${
                isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
              }`}
            >
              <div className="flex items-center gap-2 mb-3.5">
                <span className="aster-dot-live" />
                <span className="aster-mono text-[11px] tracking-[0.14em] uppercase text-slate-400">
                  aster-agent · frontier-scan
                </span>
                <span className="aster-mono text-[10px] text-[#34d399] ml-auto">live</span>
              </div>

              <div className="aster-scan-track rounded-lg bg-white/[0.02] border border-black/5 p-3.5 mb-3.5">
                <div className="aster-mono text-[12px] text-slate-300 leading-relaxed" aria-live="polite" aria-atomic="true">
                  <span className="text-[#F6CC55]">▸</span> identifying trend{" "}
                  <span className="text-white">{active + 1}</span>
                  <span className="text-slate-500"> / {TRENDS.length}</span> —{" "}
                  <span className="aster-grad-text font-semibold">{current.name}</span>
                </div>
                <div className="as-progress-bar mt-3" aria-hidden="true">
                  <div
                    className="as-progress-fill"
                    style={{
                      width: `${((active + 1) / TRENDS.length) * 100}%`,
                      background: "var(--brand-grad)",
                      transition: "width .5s cubic-bezier(0.23,1,0.32,1)",
                    }}
                  />
                </div>
              </div>

              <div className="flex flex-wrap gap-1.5">
                {TRENDS.map((t, i) => (
                  <span key={t.tag} className={i === active ? "aster-chip-on" : "aster-chip-idle"}>
                    {t.tag}
                  </span>
                ))}
              </div>
            </div>

          </div>

          {/* Right: the trend cards (active one lights up in sync) */}
          <div className="grid sm:grid-cols-2 gap-3.5">
            {TRENDS.map((trend, i) => {
              const Icon = trend.icon;
              return (
                <SpotlightCard
                  key={trend.name}
                  className={`aster-panel aster-trend-card h-full p-4 flex flex-col ${
                    i === active ? "active" : ""
                  } ${isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"}`}
                  style={{
                    transitionProperty: "opacity, transform, border-color, box-shadow",
                    transitionDuration: "600ms",
                    transitionDelay: isVisible ? `${i * 80}ms` : "0ms",
                  }}
                >
                  <div className="flex items-center gap-2.5 mb-2">
                    <div className={`aster-star ${i === active ? "on" : ""}`} style={{ width: 32, height: 32 }}>
                      <Icon className="w-4 h-4" />
                    </div>
                    <span className="aster-stage-chip">{trend.tag}</span>
                  </div>
                  <h3
                    className="text-[15px] font-semibold text-[#1c2230] mb-1"
                    style={{ fontFamily: "var(--font-display)" }}
                  >
                    {trend.name}
                  </h3>
                  <p className="text-[12.5px] text-slate-500 leading-snug">{trend.line}</p>
                </SpotlightCard>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
