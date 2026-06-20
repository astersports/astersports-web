/**
 * Account list for the Platform Console.
 * Desktop: table layout. Mobile: card layout.
 */
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Eye, Loader2, Building2, User, Inbox } from "lucide-react";

interface AccountListProps {
  type: "firm" | "individual";
}

export default function AccountList({ type }: AccountListProps) {
  const { data: accounts, isLoading } = trpc.platform.listAccounts.useQuery({ type });
  const impersonate = trpc.platform.impersonate.useMutation({
    onSuccess: (data) => {
      toast.success(`Viewing as ${data.tenantName}`, {
        description: `Redirecting to studio...`,
      });
      sessionStorage.setItem("impersonate_tenant", JSON.stringify(data));
      window.location.href = "/studio";
    },
    onError: (err) => toast.error(err.message),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-6 h-6 animate-spin text-amber-500" />
      </div>
    );
  }

  if (!accounts || accounts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <Inbox className="w-12 h-12 text-slate-600 mb-4" />
        <p className="text-slate-400">
          No {type === "firm" ? "firms" : "individuals"} yet.
        </p>
        <p className="text-sm text-slate-500 mt-1">
          {type === "firm"
            ? "Provision your first firm to get started."
            : "Invite an individual to get started."}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Desktop table */}
      <div className="hidden md:block rounded-xl border border-white/5 bg-white/[0.02] overflow-hidden">
        <div className="grid grid-cols-[1fr_100px_80px_100px_100px_60px] gap-4 px-4 py-3 border-b border-white/5 text-xs font-medium text-slate-400 uppercase tracking-wider">
          <span>Account</span>
          <span>Plan</span>
          <span>Seats</span>
          <span className="text-right">Balance</span>
          <span>Status</span>
          <span></span>
        </div>
        {accounts.map((account) => (
          <div
            key={account.id}
            className="grid grid-cols-[1fr_100px_80px_100px_100px_60px] gap-4 px-4 py-3 border-b border-white/5 last:border-0 items-center hover:bg-white/[0.02] transition-colors"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                {type === "firm" ? (
                  <Building2 className="w-4 h-4 text-amber-500 shrink-0" />
                ) : (
                  <User className="w-4 h-4 text-blue-400 shrink-0" />
                )}
                <span className="font-medium text-white truncate">{account.name}</span>
              </div>
              {account.ownerEmail && (
                <p className="text-xs text-slate-500 mt-0.5 truncate pl-6">
                  {account.ownerEmail}
                </p>
              )}
            </div>
            <div><PlanPill plan={account.plan} /></div>
            <span className="text-sm text-slate-300">
              {account.activeMembers}/{account.seats}
            </span>
            <span className="text-sm text-right font-mono text-amber-400">
              {account.creditBalance.toLocaleString()}
            </span>
            <div><StatusPill hasTrial={!!account.trialStartedAt} plan={account.plan} /></div>
            <div>
              <Button
                variant="ghost"
                size="sm"
                className="text-slate-400 hover:text-amber-400 p-1.5"
                onClick={() => impersonate.mutate({ tenantId: account.id })}
                disabled={impersonate.isPending}
                title="Impersonate"
              >
                <Eye className="w-4 h-4" />
              </Button>
            </div>
          </div>
        ))}
      </div>

      {/* Mobile cards */}
      <div className="md:hidden space-y-3">
        {accounts.map((account) => (
          <div
            key={account.id}
            className="rounded-xl border border-white/5 bg-white/[0.02] p-4"
          >
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-2 min-w-0">
                {type === "firm" ? (
                  <Building2 className="w-4 h-4 text-amber-500 shrink-0" />
                ) : (
                  <User className="w-4 h-4 text-blue-400 shrink-0" />
                )}
                <span className="font-medium text-white truncate">{account.name}</span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="text-slate-400 hover:text-amber-400 p-1.5 shrink-0"
                onClick={() => impersonate.mutate({ tenantId: account.id })}
                disabled={impersonate.isPending}
                title="Impersonate"
              >
                <Eye className="w-4 h-4" />
              </Button>
            </div>
            {account.ownerEmail && (
              <p className="text-xs text-slate-500 mb-3 truncate">{account.ownerEmail}</p>
            )}
            <div className="flex items-center gap-3 flex-wrap">
              <PlanPill plan={account.plan} />
              <StatusPill hasTrial={!!account.trialStartedAt} plan={account.plan} />
              <span className="text-xs text-slate-400">
                {account.activeMembers}/{account.seats} seats
              </span>
              <span className="text-xs font-mono text-amber-400 ml-auto">
                {account.creditBalance.toLocaleString()} cr
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PlanPill({ plan }: { plan: string }) {
  const colors: Record<string, string> = {
    none: "bg-slate-700/50 text-slate-400",
    starter: "bg-emerald-500/10 text-emerald-400",
    pro: "bg-amber-500/10 text-amber-400",
    team: "bg-blue-500/10 text-blue-400",
  };
  return (
    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${colors[plan] || colors.none}`}>
      {plan === "none" ? "No Plan" : plan.charAt(0).toUpperCase() + plan.slice(1)}
    </span>
  );
}

function StatusPill({ hasTrial, plan }: { hasTrial: boolean; plan: string }) {
  if (hasTrial) {
    return (
      <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-purple-500/10 text-purple-400">
        Trial
      </span>
    );
  }
  if (plan !== "none") {
    return (
      <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-400">
        Active
      </span>
    );
  }
  return (
    <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-slate-700/50 text-slate-400">
      Inactive
    </span>
  );
}
