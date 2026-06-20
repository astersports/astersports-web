/**
 * Platform Console — super_admin only.
 * Firms/Individuals toggle, account list, provision, grant credits, impersonate.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Building2, User, Plus, Coins, Eye, Loader2, Shield } from "lucide-react";
import AccountList from "./AccountList";
import ProvisionFirmDialog from "./ProvisionFirmDialog";
import InviteIndividualDialog from "./InviteIndividualDialog";
import GrantCreditsDialog from "./GrantCreditsDialog";

type TabType = "firm" | "individual";

export default function PlatformConsole() {
  const { user, loading: authLoading } = useAuth();
  const [tab, setTab] = useState<TabType>("firm");
  const [showProvision, setShowProvision] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [showGrant, setShowGrant] = useState(false);

  // Check super_admin access
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

  return (
    <div className="min-h-screen bg-[#0a0e1a] text-white">
      {/* Header */}
      <header className="border-b border-white/5 bg-[#0a0e1a]/95 backdrop-blur-xl sticky top-0 z-40">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold" style={{ fontFamily: "var(--font-display)" }}>
              Platform Console
            </h1>
            <p className="text-sm text-slate-400 mt-0.5">
              Manage all accounts
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="border-amber-500/30 text-amber-400 hover:bg-amber-500/10"
              onClick={() => setShowGrant(true)}
            >
              <Coins className="w-4 h-4 mr-1.5" />
              Grant Credits
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
        {/* Segmented control */}
        <div className="flex items-center justify-between mb-6">
          <div className="inline-flex rounded-lg bg-white/5 p-1">
            <button
              onClick={() => setTab("firm")}
              className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all duration-200 ${
                tab === "firm"
                  ? "bg-amber-500/20 text-amber-400 shadow-sm"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              <Building2 className="w-4 h-4" />
              Firms
            </button>
            <button
              onClick={() => setTab("individual")}
              className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all duration-200 ${
                tab === "individual"
                  ? "bg-amber-500/20 text-amber-400 shadow-sm"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              <User className="w-4 h-4" />
              Individuals
            </button>
          </div>

          <Button
            size="sm"
            className="bg-gradient-to-r from-amber-500 to-orange-500 text-black font-medium hover:opacity-90"
            onClick={() => (tab === "firm" ? setShowProvision(true) : setShowInvite(true))}
          >
            <Plus className="w-4 h-4 mr-1.5" />
            {tab === "firm" ? "Provision Firm" : "Invite Individual"}
          </Button>
        </div>

        {/* Account list */}
        <AccountList type={tab} />
      </main>

      {/* Dialogs */}
      <ProvisionFirmDialog open={showProvision} onClose={() => setShowProvision(false)} />
      <InviteIndividualDialog open={showInvite} onClose={() => setShowInvite(false)} />
      <GrantCreditsDialog open={showGrant} onClose={() => setShowGrant(false)} />
    </div>
  );
}
