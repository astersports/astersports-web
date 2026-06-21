/**
 * Dialog to provision a new firm account.
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

export default function ProvisionFirmDialog({ open, onClose }: Props) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [plan, setPlan] = useState<"none" | "starter" | "pro" | "team">("none");
  const [seats, setSeats] = useState("5");
  const [credits, setCredits] = useState("0");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [domainLock, setDomainLock] = useState("");

  const utils = trpc.useUtils();
  const provision = trpc.platform.provisionFirm.useMutation({
    onSuccess: (data) => {
      toast.success(`Firm "${data?.name}" provisioned`);
      utils.platform.listAccounts.invalidate();
      resetForm();
      onClose();
    },
    onError: (err) => toast.error(err.message),
  });

  function resetForm() {
    setName("");
    setSlug("");
    setPlan("none");
    setSeats("5");
    setCredits("0");
    setOwnerEmail("");
    setDomainLock("");
  }

  function handleNameChange(v: string) {
    setName(v);
    // Auto-generate slug from name
    setSlug(v.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !slug.trim()) {
      toast.error("Name and slug are required");
      return;
    }
    provision.mutate({
      name: name.trim(),
      slug: slug.trim(),
      plan,
      seats: Math.max(1, parseInt(seats) || 5),
      initialCredits: Math.max(0, parseInt(credits) || 0),
      ownerEmail: ownerEmail.trim() || undefined,
      domainLock: domainLock.trim() || undefined,
    });
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="bg-[#12162a] border-white/10 text-white max-w-md">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold">Provision Firm</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          <div className="space-y-1.5">
            <Label className="text-slate-300 text-sm">Firm Name</Label>
            <Input
              value={name}
              onChange={(e) => handleNameChange(e.target.value)}
              placeholder="JAYALLC"
              className="bg-white/5 border-white/10 text-white"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-slate-300 text-sm">Slug</Label>
            <Input
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="jayallc"
              className="bg-white/5 border-white/10 text-white font-mono text-sm"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-slate-300 text-sm">Plan</Label>
              <select
                value={plan}
                onChange={(e) => setPlan(e.target.value as typeof plan)}
                className="w-full h-9 rounded-md bg-white/5 border border-white/10 text-white text-sm px-3"
              >
                <option value="none">No Plan</option>
                <option value="starter">Starter</option>
                <option value="pro">Pro</option>
                <option value="team">Team</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-slate-300 text-sm">Seats</Label>
              <Input
                type="number"
                value={seats}
                onChange={(e) => setSeats(e.target.value)}
                min="1"
                className="bg-white/5 border-white/10 text-white"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-slate-300 text-sm">Initial Credits</Label>
            <Input
              type="number"
              value={credits}
              onChange={(e) => setCredits(e.target.value)}
              min="0"
              className="bg-white/5 border-white/10 text-white"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-slate-300 text-sm">Owner Email (optional)</Label>
            <Input
              type="email"
              value={ownerEmail}
              onChange={(e) => setOwnerEmail(e.target.value)}
              placeholder="jaya@jayallc.com"
              className="bg-white/5 border-white/10 text-white"
            />
            <p className="text-xs text-slate-500">User must have signed in at least once.</p>
          </div>

          <div className="space-y-1.5">
            <Label className="text-slate-300 text-sm">Domain Lock (optional)</Label>
            <Input
              value={domainLock}
              onChange={(e) => setDomainLock(e.target.value)}
              placeholder="jayallc.com"
              className="bg-white/5 border-white/10 text-white"
            />
            <p className="text-xs text-slate-500">Restrict invites to this email domain.</p>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={onClose} className="text-slate-400">
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={provision.isPending}
              className="bg-gradient-to-r from-amber-500 to-orange-500 text-black font-medium"
            >
              {provision.isPending && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}
              Provision
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
