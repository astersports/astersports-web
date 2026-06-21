/**
 * Platform Console — super_admin only.
 * Unified account management with invite links dashboard.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Building2, User, Plus, Coins, Loader2, Shield, Link2 } from "lucide-react";
import AccountList from "./AccountList";
import AddAccountDialog from "./AddAccountDialog";
import GrantCreditsDialog from "./GrantCreditsDialog";
import InviteDashboard from "./InviteDashboard";

type TabType = "firm" | "individual" | "links";

export default function PlatformConsole() {
  const { user, loading: authLoading } = useAuth();
  const [tab, setTab] = useState<TabType>("firm");
  const [showAdd, setShowAdd] = useState(false);
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
              Manage all accounts & invite links
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
              <span className="hidden sm:inline">Grant Credits</span>
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
        {/* Segmented control */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
          <div className="inline-flex rounded-lg bg-white/5 p-1">
            <button
              onClick={() => setTab("firm")}
              className={`flex items-center gap-2 px-3 sm:px-4 py-2 rounded-md text-sm font-medium transition-all duration-200 ${
                tab === "firm"
                  ? "bg-amber-500/20 text-amber-400 shadow-sm"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              <Building2 className="w-4 h-4" />
              <span className="hidden sm:inline">Firms</span>
            </button>
            <button
              onClick={() => setTab("individual")}
              className={`flex items-center gap-2 px-3 sm:px-4 py-2 rounded-md text-sm font-medium transition-all duration-200 ${
                tab === "individual"
                  ? "bg-amber-500/20 text-amber-400 shadow-sm"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              <User className="w-4 h-4" />
              <span className="hidden sm:inline">Individuals</span>
            </button>
            <button
              onClick={() => setTab("links")}
              className={`flex items-center gap-2 px-3 sm:px-4 py-2 rounded-md text-sm font-medium transition-all duration-200 ${
                tab === "links"
                  ? "bg-amber-500/20 text-amber-400 shadow-sm"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              <Link2 className="w-4 h-4" />
              <span className="hidden sm:inline">Invite Links</span>
            </button>
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

        {/* Content */}
        {tab === "links" ? (
          <InviteDashboard />
        ) : (
          <AccountList type={tab} />
        )}
      </main>

      {/* Dialogs */}
      <AddAccountDialog
        open={showAdd}
        onClose={() => setShowAdd(false)}
        defaultType={tab === "links" ? "firm" : tab}
      />
      <GrantCreditsDialog open={showGrant} onClose={() => setShowGrant(false)} />
    </div>
  );
}
