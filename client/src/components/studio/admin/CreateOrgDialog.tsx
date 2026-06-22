/**
 * CreateOrgDialog — self-serve organization creation (spec §8.4).
 *
 * MONEY-PATH / FLIP AUTHORITY NOTE (port reconciliation, do not "fix" reactively):
 * The source (personal) repo wired this dialog to `tenants.create`, which seeds a
 * 7-day trial + TRIAL_CREDITS and makes the caller owner. The ORG repo deliberately
 * REMOVED `tenants.create` on 2026-06-21 (M2): as an open `protectedProcedure` it let
 * any authenticated user MINT credited trial tenants, and it wrote `creditBalance`
 * directly with NO matching `creditLedger` row (balance↔ledger drift). Tenant creation
 * in the org repo is now invite-only (`inviteLinks.redeem`, `platform.provisionFirm`,
 * `platform.inviteIndividual`), all of which grant credits through `grantCredits`
 * (which writes the append-only ledger row).
 *
 * Restoring `tenants.create` would re-introduce the exact money-path bug the org guarded
 * against, AND it's an Architect-sign-off-gated, money-path change (CLAUDE.md §1/§4).
 * Per the port brief, a builder PREPARES but never SETS a money-path flip. So this UI is
 * ported with its confirm-gate intact but its create action SHIPS DARK behind
 * `VITE_CREATE_ORG_LIVE` (default off) — and, while a `tenants.create` procedure does
 * not exist in this repo, the action is a guarded no-op that explains the state.
 * Architect: to enable, (1) re-add a ledger-safe, rate-limited `tenants.create` server
 * procedure, then (2) wire it here and flip `VITE_CREATE_ORG_LIVE`. One flip, logged.
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

// Dark by default. Flipping this on requires a ledger-safe server procedure +
// Architect sign-off (see file header). It is NOT a *_LIVE money-path env on its own
// because no server create procedure is wired; it only un-disables the UI affordance.
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

  // The create action is intentionally NOT wired to a server mutation in the org repo
  // (see header). When CREATE_ORG_LIVE is flipped on after a ledger-safe procedure is
  // restored, replace this with the real mutation call (kept here as the wiring point).
  const submit = () => {
    if (!CREATE_ORG_LIVE) {
      toast.error("Create-org is pending Architect sign-off and is not enabled.");
      return;
    }
    // Reserved for the re-enabled, ledger-safe create procedure.
    toast.error("Create-org server procedure is not available in this build.");
    // Keep onCreated / cache-invalidation references live for the wired path:
    void onCreated;
    void utils;
  };

  const canSubmit = CREATE_ORG_LIVE && name.trim().length > 0 && ack;

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
            Create organization
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default CreateOrgDialog;
