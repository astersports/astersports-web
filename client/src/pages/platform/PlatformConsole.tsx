/**
 * Platform Console — super_admin only. Unified operations dashboard: aggregate
 * stats, a global impersonation launchpad, one searchable/filterable accounts table
 * (Accounts ⇆ Invite links), an account detail drawer, plus add-account / grant.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Coins, Plus, Loader2, Shield, Layers, Link2, ArrowLeft } from "lucide-react";
import { Link } from "wouter";
import AddAccountDialog from "./AddAccountDialog";
import GrantCreditsDialog from "./GrantCreditsDialog";
import InviteDashboard from "./InviteDashboard";
import PlatformStats from "./PlatformStats";
import AccountsTable from "./AccountsTable";
import AccountDetailDrawer from "./AccountDetailDrawer";
import ImpersonationLaunchpad from "./ImpersonationLaunchpad";

type View = "accounts" | "links";

export default function PlatformConsole() {
  const { loading: authLoading } = useAuth();
  const [view, setView] = useState<View>("accounts");
  const [showAdd, setShowAdd] = useState(false);
  const [showGrant, setShowGrant] = useState(false);
  const [detailId, setDetailId] = useState<number | null>(null);

  const { data: whoami, isLoading: adminLoading, error } = trpc.platform.whoami.useQuery();

  if (authLoading || adminLoading) {
    return (
      <div className="min-h-screen bg-[#0a0e1a] flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-amber-500" />
      </div>
    );
  }

  if (error || !whoami) {
    return (
      <div className="min-h-screen bg-[#0a0e1a] flex items-center justify-center">
        <div className="text-center">
          <Shield className="w-12 h-12 text-slate-600 mx-auto mb-4" />
          <h1 className="text-xl font-semibold text-white mb-2">Access Denied</h1>
          <p className="text-slate-400">Platform admin access required.</p>
        </div>
      </div>
    );
  }

  const tabs: { v: View; label: string; icon: typeof Layers }[] = [
    { v: "accounts", label: "Accounts", icon: Layers },
    { v: "links", label: "Invite links", icon: Link2 },
  ];

  return (
    <div className="min-h-screen bg-[#0a0e1a] text-white">
      <header className="border-b border-white/5 bg-[#0a0e1a]/95 backdrop-blur-xl sticky top-0 z-40">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold" style={{ fontFamily: "var(--font-display)" }}>
              Platform Console
            </h1>
            <p className="text-sm text-slate-400 mt-0.5">Every firm & individual, one place</p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/studio"
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-sm text-slate-300 hover:text-white hover:bg-white/5 transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              <span className="hidden sm:inline">Back to Studio</span>
            </Link>
            <ImpersonationLaunchpad />
            <Button
              variant="outline"
              size="sm"
              className="border-amber-500/30 text-amber-400 hover:bg-amber-500/10"
              onClick={() => setShowGrant(true)}
            >
              <Coins className="w-4 h-4 mr-1.5" />
              <span className="hidden sm:inline">Grant Credits</span>
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
        <PlatformStats />

        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
          <div className="inline-flex rounded-lg bg-white/5 p-1">
            {tabs.map((t) => {
              const Icon = t.icon;
              return (
                <button
                  key={t.v}
                  onClick={() => setView(t.v)}
                  className={`flex items-center gap-2 px-3 sm:px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                    view === t.v ? "bg-amber-500/20 text-amber-400" : "text-slate-400 hover:text-white"
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {t.label}
                </button>
              );
            })}
          </div>

          <Button
            size="sm"
            className="bg-gradient-to-r from-amber-500 to-orange-500 text-black font-medium hover:opacity-90"
            onClick={() => setShowAdd(true)}
          >
            <Plus className="w-4 h-4 mr-1.5" />
            Add Account
          </Button>
        </div>

        {view === "links" ? <InviteDashboard /> : <AccountsTable onManage={setDetailId} />}
      </main>

      {/* Dialogs + drawer */}
      <AddAccountDialog open={showAdd} onClose={() => setShowAdd(false)} defaultType="firm" />
      <GrantCreditsDialog open={showGrant} onClose={() => setShowGrant(false)} />
      <AccountDetailDrawer tenantId={detailId} onClose={() => setDetailId(null)} />
    </div>
  );
}
