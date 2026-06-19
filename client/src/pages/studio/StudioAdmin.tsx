/**
 * Studio Admin page — manage members/seats, view credit usage, invite users.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useTenant } from "@/contexts/TenantContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Loader2, UserPlus, Users, CreditCard, BarChart3 } from "lucide-react";
import { toast } from "sonner";

export default function StudioAdmin() {
  const { tenant } = useTenant();
  const [inviteEmail, setInviteEmail] = useState("");

  const { data: members, isLoading: membersLoading } = trpc.tenants.members.useQuery(
    { tenantId: tenant?.id ?? 0 },
    { enabled: !!tenant }
  );

  const { data: creditHistory, isLoading: creditsLoading } = trpc.studioBilling.creditHistory.useQuery(
    { tenantId: tenant?.id ?? 0 },
    { enabled: !!tenant }
  );

  const inviteMutation = trpc.tenants.invite.useMutation({
    onSuccess: () => {
      toast.success("Invitation sent");
      setInviteEmail("");
    },
    onError: (err) => toast.error(err.message),
  });

  const handleInvite = () => {
    if (!tenant || !inviteEmail) return;
    inviteMutation.mutate({ tenantId: tenant.id, email: inviteEmail, role: "member" });
  };

  if (!tenant) return null;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Admin Dashboard</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Manage {tenant.name} — members, seats, and credit usage.
        </p>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="rounded-lg bg-primary/10 p-2.5">
              <Users className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-2xl font-bold">{members?.length ?? 0}</p>
              <p className="text-xs text-muted-foreground">Members / {tenant.seats} seats</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="rounded-lg bg-primary/10 p-2.5">
              <CreditCard className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-2xl font-bold tabular-nums">{tenant.creditBalance.toLocaleString()}</p>
              <p className="text-xs text-muted-foreground">Credits remaining</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="rounded-lg bg-primary/10 p-2.5">
              <BarChart3 className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-2xl font-bold capitalize">{tenant.plan}</p>
              <p className="text-xs text-muted-foreground">Current plan</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Invite member */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Invite Member</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2">
            <Input
              placeholder={tenant.allowedEmailDomain ? `name@${tenant.allowedEmailDomain}` : "email@example.com"}
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              type="email"
            />
            <Button onClick={handleInvite} disabled={!inviteEmail || inviteMutation.isPending}>
              {inviteMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <UserPlus className="h-4 w-4 mr-1.5" />
              )}
              Invite
            </Button>
          </div>
          {tenant.allowedEmailDomain && (
            <p className="text-xs text-muted-foreground mt-2">
              Only @{tenant.allowedEmailDomain} emails can be invited.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Members list */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Members</CardTitle>
        </CardHeader>
        <CardContent>
          {membersLoading ? (
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          ) : (
            <div className="space-y-2">
              {members?.map((m) => (
                <div key={m.id} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                  <div>
                    <p className="text-sm font-medium">{m.user?.name || m.invitedEmail || "Unknown"}</p>
                    <p className="text-xs text-muted-foreground">{m.user?.email || m.invitedEmail}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="capitalize text-xs">
                      {m.role}
                    </Badge>
                    <Badge
                      variant={m.status === "active" ? "default" : "outline"}
                      className="capitalize text-xs"
                    >
                      {m.status}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Credit history */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent Credit Activity</CardTitle>
        </CardHeader>
        <CardContent>
          {creditsLoading ? (
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          ) : !creditHistory || creditHistory.length === 0 ? (
            <p className="text-sm text-muted-foreground">No credit activity yet.</p>
          ) : (
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {creditHistory.map((entry) => (
                <div key={entry.id} className="flex items-center justify-between py-1.5 text-sm">
                  <div>
                    <span className="font-medium capitalize">{entry.reason}</span>
                    <span className="text-muted-foreground ml-2 text-xs">
                      {new Date(entry.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                  <span
                    className={`font-semibold tabular-nums ${
                      entry.delta > 0 ? "text-green-600" : "text-destructive"
                    }`}
                  >
                    {entry.delta > 0 ? "+" : ""}
                    {entry.delta}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
