/**
 * TrialCard — amber gradient trial countdown card.
 * Matches spec Screen 3: Free trial pill, plan/price, big days-left countdown,
 * progress track, owner-only actions (Start plan now, Cancel trial),
 * and Card-on-File form (Stripe Elements) when no card is saved.
 */
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, CheckCircle2, CreditCard } from "lucide-react";
import { toast } from "sonner";
import { PLANS, TRIAL_DURATION_DAYS } from "@shared/billing";
import { CardOnFileForm } from "./CardOnFileForm";

interface TrialInfo {
  inTrial: boolean;
  daysRemaining: number;
  trialDay: number;
  expired: boolean;
  trialCredits: number;
  trialStartedAt: string | null;
}

interface TrialCardProps {
  trial: TrialInfo;
  plan: string;
  tenantId: number;
  isOwner: boolean;
  hasCardOnFile?: boolean;
}

export function TrialCard({ trial, plan, tenantId, isOwner, hasCardOnFile = false }: TrialCardProps) {
  const utils = trpc.useUtils();

  const cancelMutation = trpc.studioBilling.cancelTrial.useMutation({
    onSuccess: () => {
      toast.success("Trial canceled. Your credits are frozen for 90 days.");
      utils.studioBilling.billingStatus.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const startNowMutation = trpc.studioBilling.startNow.useMutation({
    onSuccess: () => {
      toast.success("Plan activated! Recurring credits will land in your pool.");
      utils.studioBilling.billingStatus.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const planDef = plan !== "none" ? PLANS[plan as keyof typeof PLANS] : null;
  const progress = ((TRIAL_DURATION_DAYS - trial.daysRemaining) / TRIAL_DURATION_DAYS) * 100;

  return (
    <div className="rounded-2xl border border-amber-500/25 bg-gradient-to-br from-amber-950/40 via-amber-900/20 to-card p-6 space-y-4">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <Badge className="bg-primary text-primary-foreground font-bold text-xs px-3 py-1">
          Free trial
        </Badge>
        {planDef && (
          <span className="text-sm text-muted-foreground">
            {planDef.name} &middot; ${planDef.priceMonthly}/mo
          </span>
        )}
      </div>

      {/* Big countdown */}
      <div className="flex items-baseline gap-2">
        <span className="text-5xl font-extrabold tracking-tight leading-none">
          {trial.daysRemaining}
        </span>
        <span className="text-lg font-semibold text-muted-foreground">
          {trial.daysRemaining === 1 ? "day left" : "days left"}
        </span>
      </div>

      {/* Progress track */}
      <div className="h-2 rounded-full bg-muted overflow-hidden">
        <div
          className="h-full rounded-full bg-primary transition-all duration-500"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Subtitle */}
      <p className="text-sm text-muted-foreground">
        Full access now. First charge on day 7 unless you cancel.
      </p>

      {/* Card on file status / form (owner only) */}
      {isOwner && (
        <>
          {hasCardOnFile ? (
            <div className="flex items-center gap-3 p-3 rounded-xl bg-emerald-950/30 border border-emerald-500/20">
              <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-emerald-300">Card on file</p>
                <p className="text-xs text-muted-foreground">
                  You'll be charged on Day 7 unless you cancel.
                </p>
              </div>
              <CreditCard className="h-4 w-4 text-muted-foreground" />
            </div>
          ) : (
            <CardOnFileForm
              tenantId={tenantId}
              onSuccess={() => utils.studioBilling.billingStatus.invalidate()}
            />
          )}
        </>
      )}

      {/* Owner actions */}
      {isOwner && (
        <div className="flex flex-col sm:flex-row gap-3 pt-2">
          <Button
            className="flex-1"
            onClick={() => startNowMutation.mutate({ tenantId })}
            disabled={startNowMutation.isPending}
          >
            {startNowMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            Start plan now
          </Button>
          <Button
            variant="outline"
            className="flex-1"
            onClick={() => cancelMutation.mutate({ tenantId })}
            disabled={cancelMutation.isPending}
          >
            {cancelMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            Cancel trial
          </Button>
        </div>
      )}
    </div>
  );
}
