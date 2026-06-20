/**
 * Studio Billing page — role-gated billing management.
 * Owner: full access (subscribe, buy packs, cancel, manage payment)
 * Admin: read-only view of plan + balance
 * Member: minimal balance view
 */
import { trpc } from "@/lib/trpc";
import { useTenant } from "@/contexts/TenantContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Check, ExternalLink, Zap, Clock, CreditCard, Lock } from "lucide-react";
import { toast } from "sonner";
import { PLANS, TOPUP_PACKS, TRIAL_DURATION_DAYS, type PlanKey } from "@shared/billing";
import { TrialCard } from "./billing/TrialCard";
import { TrialTimeline } from "./billing/TrialTimeline";
import { PaymentMethodCard } from "./billing/PaymentMethodCard";

export default function StudioBilling() {
  const { tenant } = useTenant();

  const { data: status, isLoading } = trpc.studioBilling.billingStatus.useQuery(
    { tenantId: tenant?.id ?? 0 },
    { enabled: !!tenant }
  );

  if (!tenant || isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!status) return null;

  const { role, isOwner, trial } = status;
  const isAdmin = role === "owner" || role === "admin";

  return (
    <div className="max-w-4xl mx-auto space-y-8 pb-12">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">Billing</h1>
        <p className="text-muted-foreground text-sm mt-1">
          {isOwner
            ? `Manage your subscription and credits for ${tenant.name}.`
            : isAdmin
            ? `View billing status for ${tenant.name}. Only the account owner can make changes.`
            : `Your credit balance for ${tenant.name}.`}
        </p>
      </div>

      {/* Trial section (visible to all when in trial) */}
      {trial.inTrial && !trial.expired && (
        <>
          <TrialCard trial={trial} plan={status.plan} tenantId={tenant.id} isOwner={isOwner} hasCardOnFile={status.hasCardOnFile} />
          <TrialTimeline trial={trial} />
        </>
      )}

      {/* Current status card */}
      <StatusCard status={status} tenantId={tenant.id} />

      {/* Payment method (owner only, when Stripe customer exists) */}
      {isOwner && status.stripeCustomerId && (
        <PaymentMethodCard tenantId={tenant.id} />
      )}

      {/* Subscription Plans (visible to all, purchase gated to owner) */}
      {isAdmin && <PlansSection tenantId={tenant.id} currentPlan={status.plan} isOwner={isOwner} />}

      {/* Credit Packs (visible to all, purchase gated to owner) */}
      <PacksSection tenantId={tenant.id} isOwner={isOwner} />

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

function StatusCard({ status, tenantId }: { status: any; tenantId: number }) {
  const currentPlan = status.plan ?? "none";
  const portalMutation = trpc.studioBilling.portal.useMutation({
    onSuccess: (data) => {
      if (data.portalUrl) window.open(data.portalUrl, "_blank");
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <Card>
      <CardContent className="p-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-6">
            <div>
              <p className="text-sm text-muted-foreground">Current Plan</p>
              <p className="text-xl font-bold capitalize mt-0.5">
                {currentPlan === "none" ? "No Plan" : currentPlan}
              </p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Credit Balance</p>
              <p className="text-xl font-bold tabular-nums mt-0.5">
                {status.creditBalance.toLocaleString()}
              </p>
            </div>
          </div>
          {status.isOwner && status.stripeCustomerId && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => portalMutation.mutate({ tenantId })}
              disabled={portalMutation.isPending}
            >
              <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
              Manage Billing
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function PlansSection({ tenantId, currentPlan, isOwner }: { tenantId: number; currentPlan: string; isOwner: boolean }) {
  const subscribeMutation = trpc.studioBilling.subscribe.useMutation({
    onSuccess: (data) => {
      if (data.checkoutUrl) {
        toast.info("Redirecting to Stripe checkout...");
        window.open(data.checkoutUrl, "_blank");
      }
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <h2 className="text-lg font-semibold">Subscription Plans</h2>
        {!isOwner && (
          <Badge variant="outline" className="text-xs gap-1">
            <Lock className="h-3 w-3" /> Owner only
          </Badge>
        )}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {(Object.keys(PLANS) as Array<Exclude<PlanKey, "none">>).map((key) => {
          const plan = PLANS[key];
          const isCurrent = currentPlan === key;
          return (
            <Card key={key} className={isCurrent ? "ring-2 ring-primary" : ""}>
              <CardContent className="p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-bold">{plan.name}</h3>
                  {isCurrent && <Badge>Current</Badge>}
                </div>
                <p className="text-sm text-muted-foreground">{plan.blurb}</p>
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
                  disabled={isCurrent || !isOwner || subscribeMutation.isPending}
                  onClick={() =>
                    subscribeMutation.mutate({ tenantId, plan: key })
                  }
                >
                  {!isOwner ? (
                    <><Lock className="h-3.5 w-3.5 mr-1.5" /> Owner only</>
                  ) : isCurrent ? (
                    "Active"
                  ) : (
                    "Subscribe"
                  )}
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function PacksSection({ tenantId, isOwner }: { tenantId: number; isOwner: boolean }) {
  const topupMutation = trpc.studioBilling.topup.useMutation({
    onSuccess: (data) => {
      if (data.checkoutUrl) {
        toast.info("Redirecting to checkout...");
        window.open(data.checkoutUrl, "_blank");
      }
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <h2 className="text-lg font-semibold">Credit Packs</h2>
        {!isOwner && (
          <Badge variant="outline" className="text-xs gap-1">
            <Lock className="h-3 w-3" /> Owner only
          </Badge>
        )}
      </div>
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
                  topupMutation.mutate({ tenantId, packKey: pack.key })
                }
                disabled={!isOwner || topupMutation.isPending}
              >
                {!isOwner ? (
                  <><Lock className="h-3.5 w-3.5 mr-1.5" /> Owner only</>
                ) : (
                  `$${pack.priceUsd}`
                )}
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
