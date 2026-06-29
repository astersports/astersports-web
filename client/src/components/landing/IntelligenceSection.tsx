import { Scan, Gauge, Wand2, Sparkles } from "lucide-react";
import { useInView } from "@/hooks/useInView";
import SpotlightCard from "./SpotlightCard";
import AgentConsole from "../aau/AgentConsole";

/**
 * "Intelligence under the hood" — a marketing-side look at the Print Studio
 * vision pipeline. The four stages mirror the real engine: SAM2 segmentation,
 * density/scale reading, the deterministic raster transform, and LaMa
 * inpainting. Content is grounded in the actual model stack (README / CLAUDE.md
 * §5), not invented capability claims.
 */
const STAGES = [
  {
    n: "01",
    icon: Scan,
    title: "Segment",
    model: "SAM2",
    body: "Segment-Anything isolates every print element — florals, geometrics, textures — pixel-accurate, with no manual masking.",
  },
  {
    n: "02",
    icon: Gauge,
    title: "Read",
    model: "Density · Scale",
    body: "The engine measures the pattern's rhythm — element density and scale — so every edit respects the original repeat.",
  },
  {
    n: "03",
    icon: Wand2,
    title: "Transform",
    model: "Deterministic raster",
    body: "Recolor, rescale, and redistribute through one orientation-safe pipeline. Same input, same output — every single run.",
  },
  {
    n: "04",
    icon: Sparkles,
    title: "Finish",
    model: "LaMa inpaint",
    body: "Large-mask inpainting closes the seams the edit leaves behind — production-clean fabric, generated in seconds.",
  },
];

export default function IntelligenceSection() {
  const { ref, isVisible } = useInView<HTMLDivElement>();

  return (
    <section id="intelligence" className="relative py-12 md:py-20 bg-[#FFFFFF]">
      <div className="container" ref={ref}>
        <div className="max-w-2xl mb-10 md:mb-14">
          <div
            className={`flex items-center gap-2 mb-4 transition-all duration-500 ${
              isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-5"
            }`}
          >
            <span className="aster-dot-live" />
            <span className="aster-stage-chip">AI · Machine learning</span>
          </div>
          <h2
            className={`text-3xl md:text-4xl font-bold text-[#1c2230] tracking-tight mb-4 transition-all duration-700 delay-100 ${
              isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-5"
            }`}
            style={{ fontFamily: "var(--font-display)" }}
          >
            Intelligence under <span className="aster-grad-text">the hood.</span>
          </h2>
          <p
            className={`text-lg text-slate-600 leading-relaxed transition-all duration-700 delay-200 ${
              isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-5"
            }`}
          >
            A four-stage vision pipeline — segment, read, transform, finish. Real
            models doing real production work, in the time it takes to blink.
          </p>
        </div>

        {/* the agent traces the live vision pipeline — scanning into the stage cards below */}
        <div
          className={`mb-6 max-w-xl transition-all duration-700 delay-300 ${
            isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-5"
          }`}
        >
          <AgentConsole
            tone="dark"
            label="aster-agent · pipeline"
            verb="tracing"
            steps={[
              { tag: "Segment", line: "SAM2 isolates every print element" },
              { tag: "Read", line: "density + scale, measured" },
              { tag: "Transform", line: "deterministic raster — same in, same out" },
              { tag: "Finish", line: "LaMa inpaint closes the seams" },
            ]}
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
          {STAGES.map((stage, i) => {
            const Icon = stage.icon;
            return (
              <div key={stage.n} className="relative">
                <SpotlightCard
                  className={`aster-panel h-full p-5 flex flex-col transition-all duration-600 ${
                    isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
                  }`}
                  style={{ transitionDelay: `${150 + i * 110}ms` }}
                >
                  <div className="flex items-center justify-between mb-3">
                    <span className="aster-stage-num">{stage.n}</span>
                    <div className="aster-star on" style={{ width: 34, height: 34 }}>
                      <Icon className="w-4 h-4" />
                    </div>
                  </div>
                  <h3
                    className="text-lg font-semibold text-[#1c2230] mb-1.5"
                    style={{ fontFamily: "var(--font-display)" }}
                  >
                    {stage.title}
                  </h3>
                  <p className="text-[13px] text-slate-500 leading-snug mb-3.5 flex-1">{stage.body}</p>
                  <span className="aster-stage-chip self-start">{stage.model}</span>
                </SpotlightCard>

                {/* connector pulse between stages (desktop) */}
                {i < STAGES.length - 1 && (
                  <div className="hidden lg:block aster-pipeline-line absolute top-9 -right-2 w-4 z-0" aria-hidden="true" />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
