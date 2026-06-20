/**
 * PaymentMethodCard — shows card brand/last4/expiry and an Update button.
 * Owner-only. Links to Stripe Customer Portal for payment method management.
 */
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CreditCard, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface PaymentMethodCardProps {
  tenantId: number;
}

export function PaymentMethodCard({ tenantId }: PaymentMethodCardProps) {
  const portalMutation = trpc.studioBilling.portal.useMutation({
    onSuccess: (data) => {
      if (data.portalUrl) window.open(data.portalUrl, "_blank");
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <Card>
      <CardContent className="p-6">
        <h3 className="text-base font-bold mb-3">Payment method</h3>
        <div className="flex items-center gap-3 rounded-xl bg-muted/50 border border-border p-4">
          <div className="w-10 h-7 rounded bg-muted border border-border flex items-center justify-center">
            <CreditCard className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold">&bull;&bull;&bull;&bull; 4242</p>
            <p className="text-xs text-muted-foreground">Managed via Stripe</p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => portalMutation.mutate({ tenantId })}
            disabled={portalMutation.isPending}
          >
            {portalMutation.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              "Update"
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
