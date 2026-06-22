/**
 * CreateOrgDialog — self-serve organization creation (spec §8.4).
 *
 * MONEY-PATH / FLIP AUTHORITY: this dialog calls `tenants.create`, which mints a
 * 7-day trial + TRIAL_CREDITS via the ledger-safe `grantCredits` path (re-enabled
 * 2026-06-22 after the M2 removal, which had written `creditBalance` directly with
 * no `creditLedger` row → balance↔ledger drift). The credit-minting procedure ships
 * DARK behind the SERVER flag `STUDIO_CREATE_ORG_LIVE` — the Flip-Authority-governed
 * flip (CLAUDE.md §1) that Frank sets by hand. `VITE_CREATE_ORG_LIVE` below is a
 * COSMETIC client gate: it only un-disables this button, it is NOT the security
 * boundary — the server procedure refuses until its own flag is flipped, so a direct
 * API call can't mint credits either. Both default off; build dark.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Building2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

// Cosmetic UI gate (build-time). Un-disables the button only; the server's
// STUDIO_CREATE_ORG_LIVE flag is the real money-path gate (see file header).
const CREATE_ORG_LIVE = import.meta.env.VITE_CREATE_ORG_LIVE === "true";

export function CreateOrgDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (tenantId: number) => void;
}) {
  const [name, setName] = useState("");
  const [ack, setAck] = useState(false);
  const utils = trpc.useUtils();

  const createOrg = trpc.tenants.create.useMutation({
    onSuccess: async (tenant) => {
      // Refresh the org lists the switcher + Zone A read from.
      await Promise.all([
        utils.tenants.overview.invalidate(),
        utils.tenants.myTenants.invalidate(),
      ]);
      toast.success(`Created ${tenant.name}.`);
      onCreated?.(tenant.id);
      onOpenChange(false);
      setName("");
      setAck(false);
    },
    onError: (err) => toast.error(err.message),
  });

  const submit = () => {
    if (!CREATE_ORG_LIVE) {
      toast.error("Create-org is pending Architect sign-off and is not enabled.");
      return;
    }
    createOrg.mutate({ name: name.trim() });
  };

  const canSubmit = CREATE_ORG_LIVE && name.trim().length > 0 && ack && !createOrg.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5 text-primary" />
            Create organization
          </DialogTitle>
          <DialogDescription>
            Start a new organization with its own credit pool and a 7-day free trial.
            You'll be the owner.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="org-name">Organization name</Label>
            <Input
              id="org-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Acme Design Co"
              maxLength={255}
              autoFocus
            />
          </div>
          <label className="flex items-start gap-2.5 text-sm text-muted-foreground cursor-pointer">
            <Checkbox checked={ack} onCheckedChange={(v) => setAck(v === true)} className="mt-0.5" />
            <span>
              I understand this creates a new billable organization that starts its own
              free trial.
            </span>
          </label>
          {!CREATE_ORG_LIVE && (
            <p className="flex items-start gap-2 rounded-md border border-amber-500/20 bg-amber-500/5 p-2.5 text-xs text-amber-600 dark:text-amber-400">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Self-serve organization creation is pending Architect sign-off (it mints
              trial credits). It is disabled in this build.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!canSubmit} onClick={submit}>
            {createOrg.isPending ? "Creating…" : "Create organization"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default CreateOrgDialog;
