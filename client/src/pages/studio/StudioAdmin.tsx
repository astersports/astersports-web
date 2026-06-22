/**
 * Studio Admin page — Firm Detail (Spec Screen 2).
 * Pooled balance, spend-by-member bars, User/Admin role toggles,
 * invite with domain lock, transfer ownership.
 */
import { useState, type ReactNode } from "react";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { useTenant } from "@/contexts/TenantContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Loader2,
  UserPlus,
  Users,
  CreditCard,
  BarChart3,
  Shield,
  ArrowRightLeft,
  Lock,
  Unlock,
  Link2,
  Copy,
  Check,
  XCircle,
  Clock,
} from "lucide-react";
import { toast } from "sonner";
import MembersList from "./MembersList";

export default function StudioAdmin() {
  const { tenant } = useTenant();

  if (!tenant) return null;

  const isOwner = tenant.role === "owner";
  const isAdmin = tenant.role === "admin" || isOwner;

  if (!isAdmin) {
    return (
      <div className="max-w-4xl mx-auto py-12 text-center">
        <Shield className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
        <h2 className="text-xl font-semibold">Admin Access Required</h2>
        <p className="text-muted-foreground mt-2">
          This page is restricted to account admins and owners.
        </p>
      </div>
    );
  }

  // Single-seat individual accounts have no team to manage. Plan, balance, and
  // usage live on Billing/History — so the org admin surface doesn't apply.
  if (tenant.type === "individual") {
    return (
      <div className="max-w-2xl mx-auto py-12 text-center">
        <CreditCard className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
        <h2 className="text-xl font-semibold">Individual account</h2>
        <p className="text-muted-foreground mt-2">
          This is a single-seat account, so there's no team to manage. Your plan,
          credit balance, and usage live on the Billing and History pages.
        </p>
        <div className="mt-6 flex items-center justify-center gap-3">
          <Link href="/studio/billing">
            <Button>Go to Billing</Button>
          </Link>
          <Link href="/studio/history">
            <Button variant="outline">View History</Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Admin</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Manage {tenant.name} — members, roles, and credit usage.
        </p>
      </div>

      <MetricCards tenantId={tenant.id} tenant={tenant} />
      <SpendByMember tenantId={tenant.id} />
      <MembersList tenantId={tenant.id} isOwner={isOwner} />
      <InviteCard tenantId={tenant.id} tenant={tenant} />
      {isOwner && <FirmSettings tenantId={tenant.id} tenant={tenant} />}
    </div>
  );
}

/* ─── Metric Cards ─────────────────────────────────────────────────────────── */

function MetricCards({ tenantId, tenant }: { tenantId: number; tenant: any }) {
  const { data: spend } = trpc.firmAdmin.spendByMember.useQuery(
    { tenantId },
    { enabled: !!tenantId }
  );

  return (
    // M-mobile: compact 3-up on phones (was grid-cols-1 → three tall stacked
    // cards); icon stacks above the number on mobile, inline on desktop.
    <div className="grid grid-cols-3 gap-2 sm:gap-4">
      <StatCard
        icon={<CreditCard className="h-4 w-4 sm:h-5 sm:w-5 text-amber-500" />}
        value={tenant.creditBalance.toLocaleString()}
        label="Pool balance"
      />
      <StatCard
        icon={<BarChart3 className="h-4 w-4 sm:h-5 sm:w-5 text-amber-500" />}
        value={(spend?.totalSpent7d ?? 0).toLocaleString()}
        label="Spent (7 days)"
      />
      <StatCard
        icon={<Users className="h-4 w-4 sm:h-5 sm:w-5 text-primary" />}
        value={spend?.members.length ?? 0}
        label={`Active / ${tenant.seats} seats`}
        iconBg="bg-primary/10"
      />
    </div>
  );
}

function StatCard({
  icon,
  value,
  label,
  iconBg = "bg-amber-500/10",
}: {
  icon: ReactNode;
  value: string | number;
  label: string;
  iconBg?: string;
}) {
  return (
    <Card>
      <CardContent className="p-3 sm:p-4 flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-3">
        <div className={`rounded-lg ${iconBg} p-2 sm:p-2.5 w-fit`}>{icon}</div>
        <div className="min-w-0">
          <p className="text-lg sm:text-2xl font-bold tabular-nums truncate">{value}</p>
          <p className="text-[11px] sm:text-xs text-muted-foreground leading-tight">{label}</p>
        </div>
      </CardContent>
    </Card>
  );
}

/* ─── Spend by Member ──────────────────────────────────────────────────────── */

function SpendByMember({ tenantId }: { tenantId: number }) {
  const { data, isLoading } = trpc.firmAdmin.spendByMember.useQuery(
    { tenantId },
    { enabled: !!tenantId }
  );

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-6 flex justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  const members = data?.members ?? [];
  const maxSpent = Math.max(...members.map((m) => m.spent7d), 1);
  const total7d = data?.totalSpent7d ?? 1;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <BarChart3 className="h-4 w-4" />
          Spend by Member (7 days)
        </CardTitle>
      </CardHeader>
      <CardContent>
        {members.length === 0 ? (
          <p className="text-sm text-muted-foreground">No credit usage yet.</p>
        ) : (
          <div className="space-y-3">
            {members.map((m) => {
              const pct = total7d > 0 ? Math.round((m.spent7d / total7d) * 100) : 0;
              const barWidth = maxSpent > 0 ? (m.spent7d / maxSpent) * 100 : 0;
              return (
                <div key={m.userId} className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium truncate max-w-[200px]">
                      {m.name}
                    </span>
                    <span className="text-muted-foreground tabular-nums">
                      {m.spent7d.toLocaleString()} credits ({pct}%)
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-amber-500 to-orange-500 transition-all duration-500"
                      style={{ width: `${barWidth}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}


/* ─── Invite Card ──────────────────────────────────────────────────────────── */

function InviteCard({ tenantId, tenant }: { tenantId: number; tenant: any }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"member" | "admin">("member");
  const [copied, setCopied] = useState(false);
  const utils = trpc.useUtils();

  const inviteMutation = trpc.tenants.invite.useMutation({
    onSuccess: () => {
      toast.success("Invitation sent");
      setEmail("");
      utils.tenants.members.invalidate({ tenantId });
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <UserPlus className="h-4 w-4" />
          Invite Member
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col sm:flex-row gap-2">
          <Input
            placeholder={
              tenant.allowedEmailDomain
                ? `name@${tenant.allowedEmailDomain}`
                : "email@example.com"
            }
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            type="email"
            className="flex-1"
            onKeyDown={(e) => {
              if (e.key === "Enter" && email) {
                inviteMutation.mutate({ tenantId, email, role });
              }
            }}
          />
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as "member" | "admin")}
            className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
          >
            <option value="member">Member</option>
            <option value="admin">Admin</option>
          </select>
          <Button
            onClick={() => inviteMutation.mutate({ tenantId, email, role })}
            disabled={!email || inviteMutation.isPending}
            className="bg-amber-500 hover:bg-amber-600 text-black"
          >
            {inviteMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <UserPlus className="h-4 w-4 mr-1.5" />
            )}
            Invite
          </Button>
        </div>
        {tenant.allowedEmailDomain && (
          <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1">
            <Lock className="h-3 w-3" />
            Domain restricted: only @{tenant.allowedEmailDomain} emails can join.
          </p>
        )}

        {/* Generate Join Link section */}
        <JoinLinkSection tenantId={tenantId} tenantName={tenant.name} />
      </CardContent>
    </Card>
  );
}

/* ─── Join Link Section ───────────────────────────────────────────────────── */

function JoinLinkSection({ tenantId, tenantName }: { tenantId: number; tenantName: string }) {
  const [copied, setCopied] = useState<string | null>(null);
  const utils = trpc.useUtils();

  const { data: links, isLoading } = trpc.inviteLinks.listForTenant.useQuery(
    { tenantId },
    { enabled: !!tenantId }
  );

  const createLink = trpc.inviteLinks.create.useMutation({
    onSuccess: () => {
      toast.success("Join link created");
      utils.inviteLinks.listForTenant.invalidate({ tenantId });
    },
    onError: (err) => toast.error(err.message),
  });

  const revoke = trpc.inviteLinks.revoke.useMutation({
    onSuccess: () => {
      toast.success("Link revoked");
      utils.inviteLinks.listForTenant.invalidate({ tenantId });
    },
    onError: (err) => toast.error(err.message),
  });

  function copyLink(token: string) {
    const url = `${window.location.origin}/join/${token}`;
    navigator.clipboard.writeText(url);
    setCopied(token);
    toast.success("Link copied to clipboard");
    setTimeout(() => setCopied(null), 2000);
  }

  const activeLinks = links?.filter((l) => l.effectiveStatus === "active") ?? [];

  return (
    <div className="mt-4 pt-4 border-t border-border/50">
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm font-medium flex items-center gap-1.5">
          <Link2 className="h-3.5 w-3.5 text-amber-500" />
          Shareable Join Links
        </p>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs"
          onClick={() =>
            createLink.mutate({
              type: "join",
              tenantId,
              metadata: { role: "member" },
              maxUses: null,
              expiresInDays: 30,
            })
          }
          disabled={createLink.isPending}
        >
          {createLink.isPending ? (
            <Loader2 className="h-3 w-3 animate-spin mr-1" />
          ) : (
            <Link2 className="h-3 w-3 mr-1" />
          )}
          New Link
        </Button>
      </div>

      {isLoading ? (
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      ) : activeLinks.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No active join links. Generate one to share with potential team members.
        </p>
      ) : (
        <div className="space-y-2">
          {activeLinks.map((link) => (
            <div
              key={link.id}
              className="flex items-center gap-2 p-2 rounded-md bg-muted/30 border border-border/50"
            >
              <div className="flex-1 min-w-0">
                <p className="text-xs font-mono text-muted-foreground truncate">
                  {window.location.origin}/join/{link.token.slice(0, 8)}...
                </p>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  Uses: {link.useCount}/{link.maxUses ?? "\u221e"}
                  {link.expiresAt && ` · Expires: ${new Date(link.expiresAt).toLocaleDateString()}`}
                </p>
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 w-7 p-0"
                onClick={() => copyLink(link.token)}
              >
                {copied === link.token ? (
                  <Check className="h-3.5 w-3.5 text-emerald-500" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                onClick={() => revoke.mutate({ token: link.token })}
                disabled={revoke.isPending}
              >
                <XCircle className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─── Firm Settings (Owner only) ───────────────────────────────────────────── */

function FirmSettings({ tenantId, tenant }: { tenantId: number; tenant: any }) {
  const [domain, setDomain] = useState(tenant.allowedEmailDomain ?? "");
  const [transferEmail, setTransferEmail] = useState("");
  const utils = trpc.useUtils();

  const domainMutation = trpc.firmAdmin.updateDomainLock.useMutation({
    onSuccess: (data) => {
      toast.success(
        data.allowedEmailDomain
          ? `Domain locked to @${data.allowedEmailDomain}`
          : "Domain lock removed"
      );
      utils.tenants.myTenants.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const { data: members } = trpc.tenants.members.useQuery(
    { tenantId },
    { enabled: !!tenantId }
  );

  const transferMutation = trpc.firmAdmin.transferOwnership.useMutation({
    onSuccess: () => {
      toast.success("Ownership transferred successfully");
      utils.tenants.members.invalidate({ tenantId });
      utils.tenants.myTenants.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const eligibleMembers = members?.filter(
    (m) => m.role !== "owner" && m.status === "active"
  );

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Shield className="h-4 w-4" />
          Firm Settings
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Domain Lock */}
        <div className="space-y-2">
          <label className="text-sm font-medium flex items-center gap-1.5">
            {tenant.allowedEmailDomain ? (
              <Lock className="h-3.5 w-3.5 text-amber-500" />
            ) : (
              <Unlock className="h-3.5 w-3.5 text-muted-foreground" />
            )}
            Domain Lock
          </label>
          <div className="flex gap-2">
            <Input
              placeholder="e.g. jayallc.com"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              className="flex-1"
            />
            <Button
              variant="outline"
              onClick={() =>
                domainMutation.mutate({
                  tenantId,
                  allowedEmailDomain: domain.trim() || null,
                })
              }
              disabled={domainMutation.isPending}
            >
              {domainMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Save"
              )}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            When set, only emails from this domain can be invited. Leave empty to allow any email.
          </p>
        </div>

        {/* Transfer Ownership */}
        <div className="space-y-2 border-t border-border pt-4">
          <label className="text-sm font-medium flex items-center gap-1.5">
            <ArrowRightLeft className="h-3.5 w-3.5 text-amber-500" />
            Transfer Ownership
          </label>
          <p className="text-xs text-muted-foreground">
            Transfer the owner role to another active member. You will become an admin.
          </p>
          {eligibleMembers && eligibleMembers.length > 0 ? (
            <div className="flex gap-2">
              <select
                value={transferEmail}
                onChange={(e) => setTransferEmail(e.target.value)}
                className="h-9 flex-1 rounded-md border border-input bg-transparent px-3 text-sm"
              >
                <option value="">Select member...</option>
                {eligibleMembers.map((m) => (
                  <option key={m.id} value={String(m.id)}>
                    {m.user?.name || m.user?.email || m.invitedEmail} ({m.role})
                  </option>
                ))}
              </select>
              <Button
                variant="destructive"
                disabled={!transferEmail || transferMutation.isPending}
                onClick={() => {
                  if (
                    confirm(
                      "Are you sure? This will transfer ownership and you will become an admin."
                    )
                  ) {
                    transferMutation.mutate({
                      tenantId,
                      targetMembershipId: Number(transferEmail),
                    });
                  }
                }}
              >
                {transferMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  "Transfer"
                )}
              </Button>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground italic">
              No eligible members to transfer to. Invite someone first.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
