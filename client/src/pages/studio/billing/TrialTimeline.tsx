/**
 * TrialTimeline — step-by-step trial timeline card.
 * Day 0 (signed up), Day 4 (first reminder), Day 6 (final reminder), Day 7 (first charge).
 * Current step is highlighted with amber, past steps are green with checkmark.
 */
import { Card, CardContent } from "@/components/ui/card";
import { Check } from "lucide-react";
import { TRIAL_DURATION_DAYS } from "@shared/billing";

interface TrialInfo {
  inTrial: boolean;
  daysRemaining: number;
  trialDay: number;
  expired: boolean;
  trialCredits: number;
  trialStartedAt: string | null;
}

interface TrialTimelineProps {
  trial: TrialInfo;
}

const STEPS = [
  { day: 0, label: "Signed up", description: "Card saved. Trial credits granted." },
  { day: 4, label: "First reminder", description: "Trial ends in 3 days. Here\u2019s what you\u2019ve made." },
  { day: 6, label: "Final reminder", description: "Charge tomorrow. Manage or cancel." },
  { day: 7, label: "First charge", description: "Plan goes active. Recurring credits land." },
];

export function TrialTimeline({ trial }: TrialTimelineProps) {
  return (
    <Card>
      <CardContent className="p-6">
        <h3 className="text-base font-bold mb-4">Trial timeline</h3>
        <div className="flex flex-col gap-0">
          {STEPS.map((step, i) => {
            const isDone = trial.trialDay > step.day;
            const isCurrent = !isDone && (i === 0 || trial.trialDay >= step.day);

            return (
              <div
                key={step.day}
                className={`flex gap-3 items-start py-3 ${
                  i > 0 ? "border-t border-border" : ""
                }`}
              >
                {/* Node */}
                <div
                  className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 mt-0.5 ${
                    isDone
                      ? "bg-emerald-500 text-emerald-950"
                      : isCurrent
                      ? "bg-primary text-primary-foreground"
                      : "border-2 border-border text-muted-foreground"
                  }`}
                >
                  {isDone ? <Check className="h-3.5 w-3.5" /> : step.day}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold">
                    Day {step.day} &middot; {step.label}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                    {step.description}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
