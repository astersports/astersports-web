/**
 * IndividualAccountPanel — Zone B for solo (type === "individual") accounts
 * (spec §5.3 / Q5). A solo account has no team, so this replaces the firm's
 * members/seats/invite/domain UI with: account summary, usage, and account links.
 */
import { trpc } from "@/lib/trpc";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { TypeBadge } from "../badges";
import { OrgAvatar } from "../OrgAvatar";
import { LOW_BALANCE_THRESHOLD } from "@shared/billing";
import { cn } from "@/lib/utils";
import { CreditCard, History, BookOpen, BarChart3, CheckCircle2, Layers } from "lucide-react";

type ActiveOrg = { id: number; name: string; type: "firm" | "individual"; plan: string; creditBalance: number };

export function IndividualAccountPanel({ tenant }: { tenant: ActiveOrg }) {
  const [, navigate] = useLocation();
  const { data: stats } = trpc.studio.historyStats.useQuery({ tenantId: tenant.id });
  const low = tenant.creditBalance <= LOW_BALANCE_THRESHOLD;

  return (
    <div className="space-y-4">
      {/* Account summary */}
      <Card>
        <CardContent className="p-5 flex items-center gap-4">
          <OrgAvatar name={tenant.name} type="individual" className="h-12 w-12 text-base" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="truncate font-semibold text-lg">{tenant.name}</p>
              <TypeBadge type="individual" />
            </div>
            <p className="text-sm text-muted-foreground capitalize">
              {tenant.plan && tenant.plan !== "none" ? `${tenant.plan} plan` : "Free trial"}
            </p>
          </div>
          <div className="text-right">
            <p className={cn("text-2xl font-bold tabular-nums", low && "text-destructive")}>
              {tenant.creditBalance.toLocaleString()}
            </p>
            <p className="text-xs text-muted-foreground">credits</p>
          </div>
        </CardContent>
      </Card>

      {/* Usage */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <BarChart3 className="h-4 w-4" />
            Usage
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-3 gap-4">
          <Stat icon={Layers} label="Generations" value={(stats?.totalJobs ?? 0).toLocaleString()} />
          <Stat icon={CreditCard} label="Credits spent" value={(stats?.creditsSpent ?? 0).toLocaleString()} />
          <Stat icon={CheckCircle2} label="Success rate" value={`${stats?.successRate ?? 0}%`} />
        </CardContent>
      </Card>

      {/* Account links */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Account</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => navigate("/studio/billing")}>
            <CreditCard className="h-4 w-4" /> Billing & plan
          </Button>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => navigate("/studio/ledger")}>
            <BookOpen className="h-4 w-4" /> Credit ledger
          </Button>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => navigate("/studio/history")}>
            <History className="h-4 w-4" /> History
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ icon: Icon, label, value }: { icon: typeof Layers; label: string; value: string }) {
  return (
    <div className="flex flex-col items-center text-center gap-1">
      <Icon className="h-5 w-5 text-primary" />
      <p className="text-xl font-bold tabular-nums">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

export default IndividualAccountPanel;
