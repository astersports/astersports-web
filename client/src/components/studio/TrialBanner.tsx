/**
 * TrialBanner — displays trial status, recommendation, and expiry gate.
 * Shows contextually based on the tenant's trial state:
 * - Days 1-3: Simple progress banner (days + credits remaining)
 * - Days 4-7: Recommendation banner with suggested plan
 * - Expired (day 7+ or 0 credits): Blocking modal requiring plan selection
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { useLocation } from "wouter";
import {
  Clock,
  Zap,
  TrendingUp,
  AlertTriangle,
  X,
  Sparkles,
} from "lucide-react";

interface TrialBannerProps {
  tenantId: number;
}

export function TrialBanner({ tenantId }: TrialBannerProps) {
  const [dismissed, setDismissed] = useState(false);
  const [, navigate] = useLocation();

  const { data: trial } = trpc.studio.trialStatus.useQuery(
    { tenantId },
    { refetchInterval: 60_000 }
  );

  if (!trial || !trial.inTrial) return null;

  // Trial expired — show blocking modal
  if (trial.expired || (trial.inTrial && trial.daysRemaining === 0)) {
    return <TrialExpiredGate recommendation={trial.recommendation} navigate={navigate} />;
  }

  // Dismissed by user for this session
  if (dismissed) return null;

  // Days 4-7 with recommendation
  if (trial.recommendation) {
    return (
      <div className="relative mx-4 mb-4 rounded-xl border border-amber-500/30 bg-gradient-to-r from-amber-950/40 to-orange-950/30 p-4">
        <button
          onClick={() => setDismissed(true)}
          className="absolute top-3 right-3 text-slate-400 hover:text-white transition-colors"
          aria-label="Dismiss"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="flex items-start gap-3">
          <div className="p-2 rounded-lg bg-amber-500/20">
            <TrendingUp className="w-5 h-5 text-amber-400" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-amber-200">
              Based on your usage — we recommend the{" "}
              <span className="font-bold text-amber-100">{trial.recommendation.planName}</span> plan
            </p>
            <p className="text-xs text-slate-400 mt-1">
              {trial.recommendation.reason}
              {" "}Your projected monthly usage: ~{trial.recommendation.projectedMonthly.toLocaleString()} credits.
            </p>
            <div className="flex items-center gap-3 mt-3">
              <Button
                size="sm"
                className="bg-amber-500 hover:bg-amber-600 text-black font-medium"
                onClick={() => navigate("/studio/billing")}
              >
                <Sparkles className="w-3.5 h-3.5 mr-1.5" />
                View Plans — ${trial.recommendation.priceMonthly}/mo
              </Button>
              <span className="text-xs text-slate-500">
                {trial.daysRemaining} day{trial.daysRemaining !== 1 ? "s" : ""} left in trial
              </span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Days 1-3: Simple trial progress banner. Use the tenant's actual trial grant
  // (per-tenant; not always 150 — promos / pilots / partial grants vary).
  const creditsUsed = trial.creditsUsed ?? 0;
  const trialCredits = trial.trialCredits ?? 150;
  const creditsRemaining = Math.max(0, trialCredits - creditsUsed);
  const progressPct = trialCredits > 0 ? Math.min(100, (creditsUsed / trialCredits) * 100) : 0;

  return (
    <div className="relative mx-4 mb-4 rounded-xl border border-blue-500/20 bg-blue-950/20 p-4">
      <button
        onClick={() => setDismissed(true)}
        className="absolute top-3 right-3 text-slate-400 hover:text-white transition-colors"
        aria-label="Dismiss"
      >
        <X className="w-4 h-4" />
      </button>

      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-blue-500/20">
          <Clock className="w-5 h-5 text-blue-400" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-blue-200">
              Free Trial — Day {trial.trialDay} of 7
            </p>
            <div className="flex items-center gap-1.5 text-xs text-slate-400">
              <Zap className="w-3.5 h-3.5 text-blue-400" />
              {creditsRemaining} credits remaining
            </div>
          </div>
          <div className="mt-2 h-1.5 rounded-full bg-slate-700/50 overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-blue-500 to-blue-400 transition-all duration-500"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

/** Blocking modal when trial has expired. */
function TrialExpiredGate({
  recommendation,
  navigate,
}: {
  recommendation: {
    planKey: string;
    planName: string;
    priceMonthly: number;
    creditsPerCycle: number;
    reason: string;
  } | null;
  navigate: (path: string) => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="mx-4 max-w-md w-full rounded-2xl border border-slate-700 bg-slate-900 p-8 text-center shadow-2xl">
        <div className="mx-auto w-14 h-14 rounded-full bg-amber-500/20 flex items-center justify-center mb-5">
          <AlertTriangle className="w-7 h-7 text-amber-400" />
        </div>

        <h2 className="text-xl font-bold text-white mb-2">
          Your free trial has ended
        </h2>
        <p className="text-sm text-slate-400 mb-6">
          Choose a plan to continue using Print Studio. All your work is saved and ready.
        </p>

        {recommendation && (
          <div className="rounded-xl border border-amber-500/30 bg-amber-950/20 p-4 mb-6 text-left">
            <p className="text-xs text-amber-400 font-medium uppercase tracking-wider mb-1">
              Recommended for you
            </p>
            <p className="text-lg font-bold text-white">
              {recommendation.planName} — ${recommendation.priceMonthly}/mo
            </p>
            <p className="text-xs text-slate-400 mt-1">
              {recommendation.creditsPerCycle.toLocaleString()} credits/month • {recommendation.reason}
            </p>
          </div>
        )}

        <Button
          className="w-full bg-amber-500 hover:bg-amber-600 text-black font-semibold py-3"
          onClick={() => navigate("/studio/billing")}
        >
          Choose a Plan
        </Button>

        <p className="text-xs text-slate-500 mt-4">
          Need more time? Contact us for a trial extension.
        </p>
      </div>
    </div>
  );
}
