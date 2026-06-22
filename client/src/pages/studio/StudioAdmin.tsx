/**
 * Studio Admin page — multi-org rebuild (spec §4/§5).
 * Org-identity header + Zone A (OrganizationsOverview) + Zone B branching
 * (firm admin/owner management · firm member MemberView · individual panel).
 * Zone B is collapsible (PR #6) so the overview stays reachable.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useTenant } from "@/contexts/TenantContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Loader2,
  UserPlus,
  Users,
  CreditCard,
  BarChart3,
  Crown,
  Shield,
  ArrowRightLeft,
  Lock,
  Unlock,
  Trash2,
  Link2,
  Copy,
  Check,
  XCircle,
  ChevronDown,
} from "lucide-react";
import { toast } from "sonner";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { LOW_BALANCE_THRESHOLD } from "@shared/billing";
import { OrgAvatar } from "@/components/studio/OrgAvatar";
import { TypeBadge, RoleBadge } from "@/components/studio/badges";
import { OrganizationsOverview } from "@/components/studio/admin/OrganizationsOverview";
import { IndividualAccountPanel } from "@/components/studio/admin/IndividualAccountPanel";

export default function StudioAdmin() {
  const { tenant } = useTenant();
  const [manageOpen, setManageOpen] = useState(true);

  if (!tenant) return null;

  const isOwner = tenant.role === "owner";
  const isAdmin = tenant.role === "admin" || isOwner;
  const isFirm = tenant.type === "firm";

  // "Manage" from Zone A expands the section and scrolls to it.
  const scrollToManage = () => {
    setManageOpen(true);
    requestAnimationFrame(() =>
      document.getElementById("active-org")?.scrollIntoView({ behavior: "smooth", block: "start" })
    );
  };

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      {/* Header — active org identity */}
      <div className="flex items-center gap-3">
        <OrgAvatar name={tenant.name} type={tenant.type} className="h-11 w-11 text-base" />
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-bold truncate">{tenant.name}</h1>
            <TypeBadge type={tenant.type} />
            <RoleBadge role={tenant.role} />
          </div>
          <p className="text-muted-foreground text-sm mt-0.5">Organizations &amp; account management</p>
        </div>
      </div>

      {/* Zone A — all your organizations */}
      <OrganizationsOverview onManage={scrollToManage} />

      {/* Zone B — manage the active org (collapsible, so the overview stays
          reachable without scrolling past a long management block) */}
      <section id="active-org" className="scroll-mt-24">
        <Collapsible open={manageOpen} onOpenChange={setManageOpen}>
          <CollapsibleTrigger className="flex w-full items-center gap-2 text-left">
            <h2 className="text-lg font-semibold">Manage {tenant.name}</h2>
            <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", !manageOpen && "-rotate-90")} />
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-4">
            {isFirm ? (
              isAdmin ? (
                <div className="space-y-6">
                  <MetricCards tenantId={tenant.id} tenant={tenant} />
                  <SpendByMember tenantId={tenant.id} />
                  <MembersList tenantId={tenant.id} isOwner={isOwner} />
                  <InviteCard tenantId={tenant.id} tenant={tenant} />
                  {isOwner && <FirmSettings tenantId={tenant.id} tenant={tenant} />}
                </div>
              ) : (
                <MemberView tenant={tenant} />
              )
            ) : (
              <IndividualAccountPanel tenant={tenant} />
            )}
          </CollapsibleContent>
        </Collapsible>
      </section>
    </div>
  );
}

/* ─── Member view (firm member, non-admin) ─────────────────────────────────── */

function MemberView({ tenant }: { tenant: any }) {
  const low = tenant.creditBalance <= LOW_BALANCE_THRESHOLD;
  return (
    <Card>
      <CardContent className="p-5 flex items-center justify-between gap-4">
        <div>
          <p className="font-medium">Your access</p>
          <p className="text-sm text-muted-foreground mt-0.5">
            You're a member of {tenant.name}. Member and billing management is handled by the
            organization's admins.
          </p>
        </div>
        <div className="text-right shrink-0">
          <p className={cn("text-2xl font-bold tabular-nums", low && "text-destructive")}>
            {tenant.creditBalance.toLocaleString()}
          </p>
          <p className="text-xs text-muted-foreground">pool credits</p>
        </div>
      </CardContent>
    </Card>
  );
}

/* ─── Metric Cards ─────────────────────────────────────────────────────────── */

function MetricCards({ tenantId, tenant }: { tenantId: number; tenant: any }) {
  const { data: spend } = trpc.firmAdmin.spendByMember.useQuery(
    { tenantId },
    { enabled: !!tenantId }
  );

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
      <Card>
        <CardContent className="p-4 flex items-center gap-3">
          <div className="rounded-lg bg-amber-500/10 p-2.5">
            <CreditCard className="h-5 w-5 text-amber-500" />
          </div>
          <div>
            <p className="text-2xl font-bold tabular-nums">
              {tenant.creditBalance.toLocaleString()}
            </p>
            <p className="text-xs text-muted-foreground">Pool balance</p>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-4 flex items-center gap-3">
          <div className="rounded-lg bg-amber-500/10 p-2.5">
            <BarChart3 className="h-5 w-5 text-amber-500" />
          </div>
          <div>
            <p className="text-2xl font-bold tabular-nums">
              {(spend?.totalSpent7d ?? 0).toLocaleString()}
            </p>
            <p className="text-xs text-muted-foreground">Spent (7 days)</p>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-4 flex items-center gap-3">
          <div className="rounded-lg bg-primary/10 p-2.5">
            <Users className="h-5 w-5 text-primary" />
          </div>
          <div>
            <p className="text-2xl font-bold tabular-nums">
              {spend?.members.length ?? 0}
            </p>
            <p className="text-xs text-muted-foreground">
              Active / {tenant.seats} seats
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
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

/* ─── Members List with Role Toggles ──────────────────────────────────────── */

function MembersList({ tenantId, isOwner }: { tenantId: number; isOwner: boolean }) {
  const utils = trpc.useUtils();
  const { data: members, isLoading } = trpc.tenants.members.useQuery(
    { tenantId },
    { enabled: !!tenantId }
  );

  const toggleMutation = trpc.firmAdmin.toggleRole.useMutation({
    onSuccess: () => {
      utils.tenants.members.invalidate({ tenantId });
      toast.success("Role updated");
    },
    onError: (err) => toast.error(err.message),
  });

  const removeMutation = trpc.firmAdmin.removeMember.useMutation({
    onSuccess: () => {
      utils.tenants.members.invalidate({ tenantId });
      toast.success("Member removed");
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Users className="h-4 w-4" />
          Members
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        ) : !members || members.length === 0 ? (
          <p className="text-sm text-muted-foreground">No members yet.</p>
        ) : (
          <div className="space-y-1">
            {/* Header row */}
            <div className="hidden sm:grid grid-cols-[1fr_80px_80px_40px] gap-2 px-2 py-1 text-xs text-muted-foreground font-medium">
              <span>Member</span>
              <span className="text-center">Admin</span>
              <span className="text-center">Role</span>
              <span />
            </div>
            {members.map((m) => {
              const isOwnerRow = m.role === "owner";
              const isAdminRow = m.role === "admin" || m.role === "owner";
              const displayName = m.user?.name || m.invitedEmail || "Unknown";
              const displayEmail = m.user?.email || m.invitedEmail || "";

              return (
                <div
                  key={m.id}
                  className="grid grid-cols-1 sm:grid-cols-[1fr_80px_80px_40px] gap-2 items-center px-2 py-2.5 rounded-lg hover:bg-muted/50 transition-colors border-b border-border/50 last:border-0"
                >
                  {/* Name + email */}
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-medium truncate">
                          {displayName}
                        </span>
                        {isOwnerRow && (
                          <Badge
                            variant="outline"
                            className="text-[10px] px-1.5 py-0 border-amber-500/50 text-amber-500"
                          >
                            <Crown className="h-2.5 w-2.5 mr-0.5" />
                            Owner
                          </Badge>
                        )}
                        {m.status === "invited" && (
                          <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                            Invited
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground truncate">
                        {displayEmail}
                      </p>
                    </div>
                  </div>

                  {/* Admin toggle (amber) */}
                  <div className="flex justify-center">
                    <Switch
                      checked={isAdminRow}
                      disabled={isOwnerRow || toggleMutation.isPending}
                      onCheckedChange={(checked) => {
                        if (isOwnerRow) return;
                        toggleMutation.mutate({
                          tenantId,
                          membershipId: m.id,
                          field: "role",
                          value: checked ? "admin" : "member",
                        });
                      }}
                      className="data-[state=checked]:bg-amber-500"
                    />
                  </div>

                  {/* Role badge */}
                  <div className="flex justify-center">
                    <Badge
                      variant={isAdminRow ? "default" : "secondary"}
                      className={`text-[10px] capitalize ${
                        isOwnerRow
                          ? "bg-amber-500/20 text-amber-500 border-amber-500/30"
                          : isAdminRow
                          ? "bg-amber-500/10 text-amber-400"
                          : "bg-[#4a8fd4]/10 text-[#4a8fd4]"
                      }`}
                    >
                      {m.role}
                    </Badge>
                  </div>

                  {/* Actions */}
                  <div className="flex justify-end">
                    {!isOwnerRow && m.status === "active" && (
                      <div className="flex gap-1">
                        {isOwner && (
                          <button
                            className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                            title="Remove member"
                            onClick={() => {
                              if (confirm(`Remove ${displayName} from this firm?`)) {
                                removeMutation.mutate({ tenantId, membershipId: m.id });
                              }
                            }}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    )}
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
                  Uses: {link.useCount}/{link.maxUses ?? "∞"}
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
  const { isImpersonating } = useTenant();
  // Only platform super_admin (impersonating) can modify domain lock (org guard,
  // checkpoint 2c00e38 — firmAdmin.updateDomainLock throws FORBIDDEN otherwise).
  const canEditDomain = isImpersonating;

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
          {canEditDomain ? (
            /* Super_admin (impersonating) can edit */
            <>
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
            </>
          ) : (
            /* Tenant admins see read-only display */
            <>
              <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-muted/50 border border-border">
                <span className="text-sm font-mono">
                  {tenant.allowedEmailDomain
                    ? `@${tenant.allowedEmailDomain}`
                    : "No domain restriction"}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                Domain lock is managed by the platform administrator and cannot be changed here.
              </p>
            </>
          )}
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
