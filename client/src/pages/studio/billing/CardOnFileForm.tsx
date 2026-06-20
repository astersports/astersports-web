/**
 * CardOnFileForm — Stripe Elements form to collect a card during trial.
 * Uses SetupIntent (off-session card storage) so we can charge on Day 7.
 * Owner-only: shown inside TrialCard when no card is on file.
 */
import { useState, useCallback } from "react";
import { loadStripe } from "@stripe/stripe-js";
import {
  Elements,
  PaymentElement,
  useStripe,
  useElements,
} from "@stripe/react-stripe-js";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Loader2, CreditCard, CheckCircle2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY || "");

interface CardOnFileFormProps {
  tenantId: number;
  onSuccess?: () => void;
}

/**
 * Wrapper that fetches a SetupIntent client_secret then renders the Elements form.
 */
export function CardOnFileForm({ tenantId, onSuccess }: CardOnFileFormProps) {
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [completed, setCompleted] = useState(false);

  const setupMutation = trpc.studioBilling.setupCardOnFile.useMutation({
    onSuccess: (data) => {
      setClientSecret(data.clientSecret);
      setLoading(false);
    },
    onError: (err) => {
      toast.error(err.message);
      setLoading(false);
    },
  });

  const handleStart = useCallback(() => {
    setLoading(true);
    setupMutation.mutate({ tenantId });
  }, [tenantId, setupMutation]);

  const handleComplete = useCallback(() => {
    setCompleted(true);
    onSuccess?.();
  }, [onSuccess]);

  // Already saved card
  if (completed) {
    return (
      <div className="flex items-center gap-3 p-4 rounded-xl bg-emerald-950/30 border border-emerald-500/20">
        <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0" />
        <div>
          <p className="text-sm font-semibold text-emerald-300">Card saved</p>
          <p className="text-xs text-muted-foreground">
            Your card is on file. You'll be charged on Day 7 unless you cancel.
          </p>
        </div>
      </div>
    );
  }

  // Not started yet — show CTA
  if (!clientSecret) {
    return (
      <div className="space-y-3 pt-2">
        <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/30 border border-border">
          <ShieldCheck className="h-4 w-4 text-primary mt-0.5 shrink-0" />
          <p className="text-xs text-muted-foreground leading-relaxed">
            Add a card to keep your access after the trial. You won't be charged until Day 7.
            Cancel anytime before then.
          </p>
        </div>
        <Button
          variant="outline"
          className="w-full gap-2"
          onClick={handleStart}
          disabled={loading}
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <CreditCard className="h-4 w-4" />
          )}
          Add card on file
        </Button>
      </div>
    );
  }

  // Stripe Elements form
  return (
    <div className="pt-2">
      <Elements
        stripe={stripePromise}
        options={{
          clientSecret,
          appearance: {
            theme: "night",
            variables: {
              colorPrimary: "#f5b731",
              colorBackground: "#0f1525",
              colorText: "#e2e8f0",
              colorDanger: "#ef4444",
              borderRadius: "8px",
              fontFamily: "'Space Grotesk', system-ui, sans-serif",
            },
            rules: {
              ".Input": {
                border: "1px solid rgba(255,255,255,0.1)",
                backgroundColor: "rgba(15,21,37,0.8)",
              },
              ".Input:focus": {
                border: "1px solid #f5b731",
                boxShadow: "0 0 0 1px #f5b731",
              },
            },
          },
        }}
      >
        <SetupForm onComplete={handleComplete} />
      </Elements>
    </div>
  );
}

/**
 * Inner form that uses the Stripe hooks (must be inside <Elements>).
 */
function SetupForm({ onComplete }: { onComplete: () => void }) {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const utils = trpc.useUtils();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements) return;

    setSubmitting(true);
    setError(null);

    const { error: confirmError } = await stripe.confirmSetup({
      elements,
      confirmParams: {
        return_url: window.location.href,
      },
      redirect: "if_required",
    });

    if (confirmError) {
      setError(confirmError.message ?? "Something went wrong.");
      setSubmitting(false);
    } else {
      // Success — the webhook will store the PaymentMethod
      toast.success("Card saved successfully!");
      utils.studioBilling.billingStatus.invalidate();
      onComplete();
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <PaymentElement
        options={{
          layout: "tabs",
        }}
      />
      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}
      <Button
        type="submit"
        className="w-full"
        disabled={!stripe || submitting}
      >
        {submitting ? (
          <Loader2 className="h-4 w-4 animate-spin mr-2" />
        ) : (
          <CreditCard className="h-4 w-4 mr-2" />
        )}
        Save card
      </Button>
      <p className="text-xs text-center text-muted-foreground">
        Secured by Stripe. No charge until Day 7.
      </p>
    </form>
  );
}
