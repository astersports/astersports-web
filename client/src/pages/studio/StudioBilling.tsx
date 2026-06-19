/**
 * Studio Billing page — subscribe to plans, buy top-ups, manage billing.
 */
import { trpc } from "@/lib/trpc";
import { useTenant } from "@/contexts/TenantContext";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Check, ExternalLink, Zap } from "lucide-react";
import { toast } from "sonner";
import { PLANS, TOPUP_PACKS, type PlanKey } from "@shared/billing";

export default function StudioBilling() {
  const { tenant } = useTenant();

  const { data: planInfo, isLoading } = trpc.studioBilling.planInfo.useQuery(
    { tenantId: tenant?.id ?? 0 },
    { enabled: !!tenant }
  );

  const subscribeMutation = trpc.studioBilling.subscribe.useMutation({
    onSuccess: (data) => {
      if (data.checkoutUrl) {
        toast.info("Redirecting to Stripe checkout...");
        window.open(data.checkoutUrl, "_blank");
      }
    },
    onError: (err) => toast.error(err.message),
  });

  const topupMutation = trpc.studioBilling.topup.useMutation({
    onSuccess: (data) => {
      if (data.checkoutUrl) {
        toast.info("Redirecting to checkout...");
        window.open(data.checkoutUrl, "_blank");
      }
    },
    onError: (err) => toast.error(err.message),
  });

  const portalMutation = trpc.studioBilling.portal.useMutation({
    onSuccess: (data) => {
      if (data.portalUrl) window.open(data.portalUrl, "_blank");
    },
    onError: (err) => toast.error(err.message),
  });

  if (!tenant || isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const currentPlan = planInfo?.plan ?? "none";

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Billing & Plans</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Manage your subscription and credits for {tenant.name}.
        </p>
      </div>

      {/* Current status */}
      <Card>
        <CardContent className="p-6 flex items-center justify-between">
          <div>
            <p className="text-sm text-muted-foreground">Current Plan</p>
            <p className="text-xl font-bold capitalize mt-0.5">
              {currentPlan === "none" ? "No Plan" : currentPlan}
            </p>
          </div>
          <div className="text-right">
            <p className="text-sm text-muted-foreground">Credit Balance</p>
            <p className="text-xl font-bold tabular-nums mt-0.5">
              {tenant.creditBalance.toLocaleString()}
            </p>
          </div>
          {planInfo?.stripeCustomerId && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => portalMutation.mutate({ tenantId: tenant.id })}
              disabled={portalMutation.isPending}
            >
              <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
              Manage Billing
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Plans */}
      <div>
        <h2 className="text-lg font-semibold mb-4">Subscription Plans</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {(Object.keys(PLANS) as Array<Exclude<PlanKey, "none">>).map((key) => {
            const plan = PLANS[key];
            const isCurrent = currentPlan === key;
            return (
              <Card key={key} className={isCurrent ? "ring-2 ring-primary" : ""}>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-lg">{plan.name}</CardTitle>
                    {isCurrent && <Badge>Current</Badge>}
                  </div>
                  <CardDescription>{plan.blurb}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <span className="text-3xl font-bold">${plan.priceMonthly}</span>
                    <span className="text-muted-foreground text-sm">
                      /{plan.perSeat ? "seat/" : ""}mo
                    </span>
                  </div>
                  <ul className="space-y-2">
                    {plan.features.map((f) => (
                      <li key={f} className="flex items-center gap-2 text-sm">
                        <Check className="h-4 w-4 text-primary shrink-0" />
                        {f}
                      </li>
                    ))}
                  </ul>
                  <Button
                    className="w-full"
                    variant={isCurrent ? "outline" : "default"}
                    disabled={isCurrent || subscribeMutation.isPending}
                    onClick={() =>
                      subscribeMutation.mutate({ tenantId: tenant.id, plan: key })
                    }
                  >
                    {isCurrent ? "Active" : "Subscribe"}
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      {/* Top-ups */}
      <div>
        <h2 className="text-lg font-semibold mb-4">Credit Top-ups</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {TOPUP_PACKS.map((pack) => (
            <Card key={pack.key}>
              <CardContent className="p-5 space-y-3">
                <div className="flex items-center gap-2">
                  <Zap className="h-4 w-4 text-primary" />
                  <span className="font-semibold">{pack.name}</span>
                </div>
                <div>
                  <span className="text-2xl font-bold">{pack.credits.toLocaleString()}</span>
                  <span className="text-muted-foreground text-sm ml-1">credits</span>
                </div>
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() =>
                    topupMutation.mutate({ tenantId: tenant.id, packKey: pack.key })
                  }
                  disabled={topupMutation.isPending}
                >
                  ${pack.priceUsd}
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {/* Test mode notice */}
      <Card className="bg-muted/50">
        <CardContent className="p-4 text-sm text-muted-foreground">
          <strong>Test Mode:</strong> Use card number <code>4242 4242 4242 4242</code> with any
          future expiry and CVC to test payments. No real charges will be made.
        </CardContent>
      </Card>
    </div>
  );
}
