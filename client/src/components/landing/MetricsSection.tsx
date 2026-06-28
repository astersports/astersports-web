import { useCountUp } from "@/hooks/useCountUp";
import { useInView } from "@/hooks/useInView";
import { PRODUCTS } from "@/lib/services";
import SpotlightCard from "./SpotlightCard";

interface Metric {
  value: number;
  label: string;
  prefix?: string;
  suffix?: string;
}

// Derived from the live service registry so the headline numbers can never
// drift from what the constellation actually renders.
const shipping = PRODUCTS.filter(
  (p) => p.status === "live" || p.status === "beta" || p.status === "members"
).length;

const METRICS: Metric[] = [
  { value: PRODUCTS.length, label: "Surfaces in the constellation" },
  { value: shipping, label: "Products live or in beta" },
  { value: 10, prefix: "<", suffix: "s", label: "Average Studio render" },
  { value: 100, suffix: "%", label: "Designed & built in-house" },
];

function MetricTile({ metric, start, index }: { metric: Metric; start: boolean; index: number }) {
  const value = useCountUp(metric.value, 1600, start);
  return (
    <SpotlightCard
      className={`aster-panel p-6 text-center transition-all duration-700 ${
        start ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"
      }`}
      style={{ transitionDelay: `${index * 90}ms` }}
    >
      <div
        className="aster-grad-text text-4xl md:text-5xl font-bold tabular-nums leading-none"
        style={{ fontFamily: "var(--font-display)" }}
      >
        {metric.prefix}
        {Math.round(value)}
        {metric.suffix}
      </div>
      <div className="mt-2.5 text-[12.5px] text-slate-400 leading-snug">{metric.label}</div>
    </SpotlightCard>
  );
}

export default function MetricsSection() {
  const { ref, isVisible } = useInView<HTMLDivElement>();

  return (
    <section className="relative py-10 md:py-14 bg-[#1a2133]">
      <div className="container" ref={ref}>
        {/* agent eyebrow — ties the metrics into the live-scan motif */}
        <div
          className={`flex items-center gap-2 mb-4 transition-all duration-500 ${
            isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
          }`}
        >
          <span className="aster-dot-live" />
          <span className="aster-mono text-[11px] tracking-[0.14em] uppercase text-slate-400">
            aster-agent · live metrics
          </span>
          <span className="flex-1 h-px bg-white/10" />
          <span className="aster-mono text-[10px] text-[#34d399]">live</span>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
          {METRICS.map((metric, i) => (
            <MetricTile key={metric.label} metric={metric} start={isVisible} index={i} />
          ))}
        </div>
      </div>
    </section>
  );
}
