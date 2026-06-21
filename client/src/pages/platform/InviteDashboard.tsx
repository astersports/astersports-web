/**
 * Invite Dashboard — shows all outstanding invite links with status.
 * Allows revoking and copying links.
 */
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  Link2,
  Copy,
  XCircle,
  Clock,
  CheckCircle2,
  Building2,
  User,
  Users,
  Loader2,
  Ban,
} from "lucide-react";
import { useState } from "react";

export default function InviteDashboard() {
  const { data: links, isLoading } = trpc.inviteLinks.list.useQuery({ status: "all" });
  const utils = trpc.useUtils();
  const [copiedId, setCopiedId] = useState<number | null>(null);

  const revoke = trpc.inviteLinks.revoke.useMutation({
    onSuccess: () => {
      toast.success("Link revoked");
      utils.inviteLinks.list.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  function copyLink(token: string, id: number) {
    const url = `${window.location.origin}/join/${token}`;
    navigator.clipboard.writeText(url);
    setCopiedId(id);
    toast.success("Copied to clipboard");
    setTimeout(() => setCopiedId(null), 2000);
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-5 h-5 animate-spin text-slate-500" />
      </div>
    );
  }

  if (!links || links.length === 0) {
    return (
      <div className="text-center py-12">
        <Link2 className="w-8 h-8 text-slate-600 mx-auto mb-3" />
        <p className="text-sm text-slate-400">No invite links created yet.</p>
        <p className="text-xs text-slate-500 mt-1">Use "Add Account" to generate shareable invite links.</p>
      </div>
    );
  }

  const statusConfig = {
    active: { icon: Clock, color: "text-blue-400", bg: "bg-blue-500/10", label: "Active" },
    expired: { icon: Clock, color: "text-slate-400", bg: "bg-slate-500/10", label: "Expired" },
    revoked: { icon: Ban, color: "text-red-400", bg: "bg-red-500/10", label: "Revoked" },
    redeemed: { icon: CheckCircle2, color: "text-emerald-400", bg: "bg-emerald-500/10", label: "Redeemed" },
  };

  const typeIcons = {
    firm: Building2,
    individual: User,
    join: Users,
  };

  return (
    <div className="space-y-2">
      {links.map((link) => {
        // Use the server-computed effectiveStatus so time-expired / maxed-out
        // links don't render as "Active" with live Copy/Revoke.
        const linkStatus = link.effectiveStatus ?? link.status;
        const status = statusConfig[linkStatus as keyof typeof statusConfig] ?? statusConfig.active;
        const StatusIcon = status.icon;
        const TypeIcon = typeIcons[link.type as keyof typeof typeIcons] ?? Link2;
        const metadata = (link.metadata ?? {}) as Record<string, any>;

        return (
          <div
            key={link.id}
            className="flex items-center gap-3 p-3 rounded-lg border border-white/5 bg-white/[0.02] hover:bg-white/[0.04] transition-colors"
          >
            {/* Type icon */}
            <div className="w-8 h-8 rounded-md bg-white/5 flex items-center justify-center shrink-0">
              <TypeIcon className="w-4 h-4 text-slate-400" />
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-white truncate">
                  {link.type === "firm" && (metadata.firmName || "Organization")}
                  {link.type === "individual" && "Individual"}
                  {link.type === "join" && (link.tenantName || "Team Join")}
                </span>
                <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${status.bg} ${status.color}`}>
                  <StatusIcon className="w-2.5 h-2.5" />
                  {status.label}
                </span>
              </div>
              <div className="flex items-center gap-2 mt-0.5 text-xs text-slate-500">
                <span>Used: {link.useCount}/{link.maxUses ?? "∞"}</span>
                {link.expiresAt && (
                  <>
                    <span>·</span>
                    <span>Expires: {new Date(link.expiresAt).toLocaleDateString()}</span>
                  </>
                )}
                <span>·</span>
                <span>{new Date(link.createdAt).toLocaleDateString()}</span>
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-1 shrink-0">
              {linkStatus === "active" && (
                <>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 w-7 p-0 text-slate-400 hover:text-white"
                    onClick={() => copyLink(link.token, link.id)}
                  >
                    {copiedId === link.id ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 w-7 p-0 text-slate-400 hover:text-red-400"
                    onClick={() => revoke.mutate({ token: link.token })}
                    disabled={revoke.isPending}
                  >
                    <XCircle className="w-3.5 h-3.5" />
                  </Button>
                </>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
