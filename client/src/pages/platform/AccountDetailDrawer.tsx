/**
 * AccountDetailDrawer — super-admin detail panel for one account (platform.accountDetail).
 * Members, spend, recent ledger + quick actions (impersonate, inline grant). (Spec §16.2)
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Eye, Loader2, Coins, Users } from "lucide-react";
import { TypePill, PlanPill, StatusPill } from "./pills";

export default function AccountDetailDrawer({
  tenantId,
  onClose,
}: {
  tenantId: number | null;
  onClose: () => void;
}) {
  const open = tenantId !== null;
  const utils = trpc.useUtils();
  const [grantAmount, setGrantAmount] = useState("");

  const { data, isLoading } = trpc.platform.accountDetail.useQuery(
    { tenantId: tenantId ?? 0 },
    { enabled: open }
  );

  const impersonate = trpc.platform.impersonate.useMutation({
    onSuccess: (d) => {
      toast.success(`Viewing as ${d.tenantName}`, { description: "Redirecting…" });
      window.location.href = "/studio";
    },
    onError: (err) => toast.error(err.message),
  });

  const grant = trpc.platform.grantCredits.useMutation({
    onSuccess: () => {
      toast.success("Credits granted");
      setGrantAmount("");
      if (tenantId) utils.platform.accountDetail.invalidate({ tenantId });
      utils.platform.listAccounts.invalidate();
      utils.platform.stats.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const t = data?.tenant;

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto bg-[#0a0e1a] text-white border-white/10">
        {isLoading || !t ? (
          <div className="flex items-center justify-center py-24">
            <Loader2 className="w-6 h-6 animate-spin text-amber-500" />
          </div>
        ) : (
          <>
            <SheetHeader>
              <SheetTitle className="text-white flex items-center gap-2">{t.name}</SheetTitle>
              <SheetDescription className="flex items-center gap-2">
                <TypePill type={t.type} />
                <PlanPill plan={t.plan} />
                <StatusPill plan={t.plan} hasTrial={!!t.trialStartedAt} />
              </SheetDescription>
            </SheetHeader>

            {/* Metrics */}
            <div className="grid grid-cols-3 gap-3 mt-4">
              <Metric label="Balance" value={t.creditBalance.toLocaleString()} accent />
              <Metric label="Spent 7d" value={(data?.spent7d ?? 0).toLocaleString()} />
              <Metric label="Spent all" value={(data?.spentAll ?? 0).toLocaleString()} />
            </div>

            {/* Actions */}
            <div className="mt-5 space-y-3">
              <Button
                variant="outline"
                className="w-full border-amber-500/30 text-amber-400 hover:bg-amber-500/10"
                disabled={impersonate.isPending}
                onClick={() => impersonate.mutate({ tenantId: t.id })}
              >
                <Eye className="w-4 h-4 mr-2" />
                Impersonate
              </Button>
              <div className="flex gap-2">
                <Input
                  type="number"
                  min={1}
                  value={grantAmount}
                  onChange={(e) => setGrantAmount(e.target.value)}
                  placeholder="Grant credits…"
                  className="bg-white/[0.03] border-white/10 text-white placeholder:text-slate-500"
                />
                <Button
                  disabled={grant.isPending || !(Number(grantAmount) > 0)}
                  onClick={() => grant.mutate({ tenantId: t.id, amount: Math.floor(Number(grantAmount)) })}
                >
                  {grant.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Coins className="w-4 h-4" />}
                </Button>
              </div>
            </div>

            {/* Members */}
            <div className="mt-6">
              <h3 className="text-sm font-medium text-slate-300 mb-2 flex items-center gap-1.5">
                <Users className="w-4 h-4" /> Members ({data?.members.length ?? 0})
              </h3>
              <div className="space-y-1">
                {(data?.members ?? []).map((m) => (
                  <div key={m.id} className="flex items-center justify-between rounded-lg bg-white/[0.02] px-3 py-2">
                    <div className="min-w-0">
                      <p className="text-sm truncate">{m.user?.name || m.invitedEmail || "Unknown"}</p>
                      <p className="text-xs text-slate-500 truncate">{m.user?.email || m.invitedEmail || ""}</p>
                    </div>
                    <span className="text-xs text-slate-400 capitalize shrink-0">
                      {m.role}{m.status !== "active" ? ` · ${m.status}` : ""}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Recent ledger */}
            <div className="mt-6">
              <h3 className="text-sm font-medium text-slate-300 mb-2">Recent activity</h3>
              <div className="space-y-1">
                {(data?.recentLedger ?? []).length === 0 ? (
                  <p className="text-xs text-slate-500">No credit activity yet.</p>
                ) : (
                  (data?.recentLedger ?? []).map((l) => (
                    <div key={l.id} className="flex items-center justify-between text-xs px-1 py-1.5 border-b border-white/5 last:border-0">
                      <span className="text-slate-400 capitalize">{l.reason}</span>
                      <span className={l.delta < 0 ? "text-red-400" : "text-emerald-400"}>
                        {l.delta > 0 ? "+" : ""}{l.delta.toLocaleString()}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Metric({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-lg bg-white/[0.02] border border-white/5 p-3 text-center">
      <p className={`text-lg font-bold tabular-nums ${accent ? "text-amber-400" : "text-white"}`}>{value}</p>
      <p className="text-xs text-slate-500">{label}</p>
    </div>
  );
}
