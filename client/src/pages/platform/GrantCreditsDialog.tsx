/**
 * Dialog to grant credits to any account.
 */
import { useState, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2 } from "lucide-react";

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function GrantCreditsDialog({ open, onClose }: Props) {
  const [tenantId, setTenantId] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  // Stable idempotency key per grant action: reused across a retry of the same
  // submit (so a double-submit/retry can't double-grant), regenerated after a
  // successful grant so a deliberate second grant is allowed.
  const idemKey = useRef<string | null>(null);

  // Fetch all accounts for the dropdown
  const { data: accounts } = trpc.platform.listAccounts.useQuery(
    { type: "all" },
    { enabled: open }
  );

  const utils = trpc.useUtils();
  const grant = trpc.platform.grantCredits.useMutation({
    onSuccess: (data) => {
      toast.success(`Credits granted. New balance: ${data.newBalance.toLocaleString()}`);
      utils.platform.listAccounts.invalidate();
      idemKey.current = null; // next grant gets a fresh key
      setTenantId("");
      setAmount("");
      setNote("");
      onClose();
    },
    onError: (err) => toast.error(err.message),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const tid = parseInt(tenantId);
    const amt = parseInt(amount);
    if (!tid || !amt || amt < 1) {
      toast.error("Select an account and enter a valid amount");
      return;
    }
    if (!idemKey.current) idemKey.current = crypto.randomUUID();
    grant.mutate({ tenantId: tid, amount: amt, note: note.trim() || undefined, idempotencyKey: idemKey.current });
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="bg-[#12162a] border-white/10 text-white max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold">Grant Credits</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          <div className="space-y-1.5">
            <Label className="text-slate-300 text-sm">Account</Label>
            <select
              value={tenantId}
              onChange={(e) => setTenantId(e.target.value)}
              className="w-full h-9 rounded-md bg-white/5 border border-white/10 text-white text-sm px-3"
            >
              <option value="">Select account...</option>
              {accounts?.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({a.creditBalance.toLocaleString()} credits)
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-slate-300 text-sm">Amount</Label>
            <Input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              min="1"
              placeholder="100"
              className="bg-white/5 border-white/10 text-white"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-slate-300 text-sm">Note (optional)</Label>
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Pilot bonus, support credit, etc."
              className="bg-white/5 border-white/10 text-white"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={onClose} className="text-slate-400">
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={grant.isPending}
              className="bg-gradient-to-r from-amber-500 to-orange-500 text-black font-medium"
            >
              {grant.isPending && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}
              Grant
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
