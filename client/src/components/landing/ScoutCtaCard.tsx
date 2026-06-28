import { ArrowUpRight } from "lucide-react";
import { ALL_SERVICES } from "@/lib/services";

/**
 * Renders the CTA the scout routed to. THIS is the condition-C1 boundary: the
 * agent only ever returns a `serviceId`; the link, name, and tagline come from
 * the client-side service registry here — the model never emits a URL. An
 * unknown id renders nothing.
 */
export default function ScoutCtaCard({ serviceId }: { serviceId: string }) {
  const svc = ALL_SERVICES.find((s) => s.id === serviceId);
  if (!svc) return null;
  const Icon = svc.icon;

  return (
    <a
      href={svc.href}
      {...(svc.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      className="aster-panel group flex items-center gap-3 p-3 mt-2 no-underline"
    >
      <div className="aster-star on" style={{ width: 34, height: 34, flexShrink: 0 }}>
        <Icon className="w-4 h-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[13.5px] font-semibold text-white leading-tight" style={{ fontFamily: "var(--font-display)" }}>
          {svc.name}
        </div>
        <div className="text-[11.5px] text-slate-400 truncate">{svc.tagline}</div>
      </div>
      <ArrowUpRight className="w-4 h-4 text-slate-500 group-hover:text-[#F6CC55] transition-colors flex-shrink-0" />
    </a>
  );
}
