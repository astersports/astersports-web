/**
 * Dialog to invite an individual (creates a single-seat account).
 */
import { useState } from "react";
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

export default function InviteIndividualDialog({ open, onClose }: Props) {
  const [email, setEmail] = useState("");
  const [credits, setCredits] = useState("50");

  const utils = trpc.useUtils();
  const invite = trpc.platform.inviteIndividual.useMutation({
    onSuccess: (data) => {
      const msg = data?.userExists
        ? `Account created and linked to existing user`
        : `Account created — user will be linked on first sign-in`;
      toast.success(msg);
      utils.platform.listAccounts.invalidate();
      setEmail("");
      setCredits("50");
      onClose();
    },
    onError: (err) => toast.error(err.message),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) {
      toast.error("Email is required");
      return;
    }
    invite.mutate({
      email: email.trim(),
      // Distinguish an explicit 0 (valid) from blank/invalid (default 50); never
      // pass a negative. `parseInt || 50` silently turned 0 into a 50-credit grant.
      initialCredits: Number.isNaN(parseInt(credits, 10)) ? 50 : Math.max(0, parseInt(credits, 10)),
    });
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="bg-[#12162a] border-white/10 text-white max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold">Invite Individual</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          <div className="space-y-1.5">
            <Label className="text-slate-300 text-sm">Email</Label>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="designer@example.com"
              className="bg-white/5 border-white/10 text-white"
              autoFocus
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-slate-300 text-sm">Trial Credits</Label>
            <Input
              type="number"
              value={credits}
              onChange={(e) => setCredits(e.target.value)}
              min="0"
              className="bg-white/5 border-white/10 text-white"
            />
            <p className="text-xs text-slate-500">
              Granted on account creation. Default: 50 (5 generations).
            </p>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={onClose} className="text-slate-400">
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={invite.isPending}
              className="bg-gradient-to-r from-amber-500 to-orange-500 text-black font-medium"
            >
              {invite.isPending && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}
              Invite
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
