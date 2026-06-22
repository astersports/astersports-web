/**
 * Cross-org rollup header for the Platform Console.
 * Account mix, credit liability, trial pipeline, and the 7-day top spenders —
 * all from the single platform.stats aggregate (no per-account fan-out).
 */
import { trpc } from "@/lib/trpc";
import {
  Building2,
  User,
  Coins,
  CreditCard,
  Clock,
  TrendingDown,
  Loader2,
  type LucideIcon,
} from "lucide-react";

export default function PlatformStats() {
  const { data, isLoading } = trpc.platform.stats.useQuery();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-10 mb-6">
        <Loader2 className="w-5 h-5 animate-spin text-amber-500" />
      </div>
    );
  }
  if (!data) return null;

  return (
    <div className="space-y-4 mb-6">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <KPI icon={Building2} label="Firms" value={data.firmCount} />
        <KPI icon={User} label="Individuals" value={data.individualCount} />
        <KPI icon={Coins} label="Credits out" value={data.totalCreditsOutstanding.toLocaleString()} />
        <KPI icon={CreditCard} label="Paid" value={data.paidCount} />
        <KPI
          icon={Clock}
          label="In trial"
          value={data.inTrialCount}
          sub={data.trialsExpiringSoon > 0 ? `${data.trialsExpiringSoon} expiring` : undefined}
          subTone="warn"
        />
        <KPI icon={TrendingDown} label="Spent · 7d" value={data.spent7dTotal.toLocaleString()} />
      </div>

      {data.topSpenders.length > 0 && (
        <div className="rounded-xl border border-white/5 bg-white/[0.02] p-4">
          <p className="text-[11px] uppercase tracking-wider text-slate-400 mb-3">
            Top spenders · 7 days
          </p>
          <div className="space-y-2">
            {data.topSpenders.map((s, i) => (
              <div key={s.tenantId} className="flex items-center gap-3">
                <span className="text-xs text-slate-500 w-4 tabular-nums">{i + 1}</span>
                <span className="text-sm text-white flex-1 truncate">{s.name}</span>
                <span className="text-sm font-mono text-amber-400 tabular-nums">
                  {s.spent7d.toLocaleString()} cr
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function KPI({
  icon: Icon,
  label,
  value,
  sub,
  subTone = "muted",
}: {
  icon: LucideIcon;
  label: string;
  value: string | number;
  sub?: string;
  subTone?: "muted" | "warn";
}) {
  return (
    <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3">
      <div className="flex items-center gap-1.5 text-slate-400 mb-1.5">
        <Icon className="w-3.5 h-3.5" />
        <span className="text-[11px] uppercase tracking-wider truncate">{label}</span>
      </div>
      <p className="text-xl font-bold text-white tabular-nums truncate">{value}</p>
      {sub && (
        <p className={`text-[11px] mt-0.5 ${subTone === "warn" ? "text-amber-400" : "text-slate-500"}`}>
          {sub}
        </p>
      )}
    </div>
  );
}
