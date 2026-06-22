/**
 * Pills for the Platform Console (dark palette). Kept local to the console so its
 * super-admin surface stays visually distinct from the tenant-facing admin while
 * sharing the same Type / Plan / Status vocabulary.
 */
import { Building2, User } from "lucide-react";

export function TypePill({ type }: { type: "firm" | "individual" }) {
  const isFirm = type === "firm";
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
        isFirm ? "bg-amber-500/10 text-amber-400" : "bg-blue-500/10 text-blue-400"
      }`}
    >
      {isFirm ? <Building2 className="w-3 h-3" /> : <User className="w-3 h-3" />}
      {isFirm ? "Firm" : "Individual"}
    </span>
  );
}

export function PlanPill({ plan }: { plan: string }) {
  const colors: Record<string, string> = {
    none: "bg-slate-700/50 text-slate-400",
    starter: "bg-emerald-500/10 text-emerald-400",
    pro: "bg-amber-500/10 text-amber-400",
    team: "bg-blue-500/10 text-blue-400",
  };
  return (
    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${colors[plan] || colors.none}`}>
      {plan === "none" ? "No plan" : plan.charAt(0).toUpperCase() + plan.slice(1)}
    </span>
  );
}

/** Derived status: paid plan → Active, otherwise Trial (no tenant.status column). */
export function StatusPill({ plan, hasTrial }: { plan: string; hasTrial: boolean }) {
  if (plan !== "none") {
    return <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-400">Active</span>;
  }
  if (hasTrial) {
    return <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-purple-500/10 text-purple-400">Trial</span>;
  }
  return <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-slate-700/50 text-slate-400">Inactive</span>;
}
