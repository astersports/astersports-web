/**
 * Unified "Add Account" dialog — replaces separate ProvisionFirm and InviteIndividual dialogs.
 * Two delivery modes:
 *   1. "Create now" — provisions immediately (existing behavior)
 *   2. "Generate invite link" — creates a shareable link for self-service signup
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Building2,
  User,
  Users,
  Link2,
  Loader2,
  Copy,
  Check,
  ArrowRight,
} from "lucide-react";

interface Props {
  open: boolean;
  onClose: () => void;
  /** Pre-select a type when opening */
  defaultType?: "firm" | "individual" | "join";
  /** For "join" type: pre-fill the tenant */
  tenantId?: number;
  tenantName?: string;
}

type AccountType = "firm" | "individual" | "join";
type DeliveryMode = "create" | "link";

export default function AddAccountDialog({
  open,
  onClose,
  defaultType = "firm",
  tenantId,
  tenantName,
}: Props) {
  const [step, setStep] = useState<"type" | "details" | "result">("type");
  const [accountType, setAccountType] = useState<AccountType>(defaultType);
  const [deliveryMode, setDeliveryMode] = useState<DeliveryMode>("link");

  // Firm fields
  const [firmName, setFirmName] = useState("");
  const [plan, setPlan] = useState<"none" | "starter" | "pro" | "team">("none");
  const [seats, setSeats] = useState("5");
  const [credits, setCredits] = useState("0");
  const [domainLock, setDomainLock] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");

  // Individual fields
  const [individualCredits, setIndividualCredits] = useState("50");
  const [individualEmail, setIndividualEmail] = useState("");

  // Join fields
  const [joinRole, setJoinRole] = useState<"admin" | "member">("member");

  // Link options
  const [maxUses, setMaxUses] = useState("1");
  const [expiresInDays, setExpiresInDays] = useState("30");

  // Result
  const [generatedToken, setGeneratedToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const utils = trpc.useUtils();

  // Mutations
  const provisionFirm = trpc.platform.provisionFirm.useMutation({
    onSuccess: (data) => {
      toast.success(`Firm "${data?.name}" provisioned`);
      utils.platform.listAccounts.invalidate();
      handleClose();
    },
    onError: (err) => toast.error(err.message),
  });

  const inviteIndividual = trpc.platform.inviteIndividual.useMutation({
    onSuccess: (data) => {
      const msg = data?.userExists
        ? `Account created and linked to existing user`
        : `Account created — user will be linked on first sign-in`;
      toast.success(msg);
      utils.platform.listAccounts.invalidate();
      handleClose();
    },
    onError: (err) => toast.error(err.message),
  });

  const createLink = trpc.inviteLinks.create.useMutation({
    onSuccess: (data) => {
      setGeneratedToken(data.token);
      setStep("result");
      utils.inviteLinks.list.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  function handleClose() {
    setStep("type");
    setAccountType(defaultType);
    setDeliveryMode("link");
    setFirmName("");
    setPlan("none");
    setSeats("5");
    setCredits("0");
    setDomainLock("");
    setOwnerEmail("");
    setIndividualCredits("50");
    setIndividualEmail("");
    setJoinRole("member");
    setMaxUses("1");
    setExpiresInDays("30");
    setGeneratedToken(null);
    setCopied(false);
    onClose();
  }

  function handleTypeSelect(type: AccountType) {
    setAccountType(type);
    setStep("details");
  }

  function handleSubmit() {
    if (deliveryMode === "link") {
      // Generate invite link
      if (accountType === "firm") {
        createLink.mutate({
          type: "firm",
          metadata: {
            firmName: firmName.trim() || undefined,
            plan,
            seats: parseInt(seats) || 5,
            initialCredits: parseInt(credits) || 0,
            domainLock: domainLock.trim() || undefined,
          },
          maxUses: parseInt(maxUses) || 1,
          expiresInDays: parseInt(expiresInDays) || 30,
        });
      } else if (accountType === "individual") {
        createLink.mutate({
          type: "individual",
          metadata: {
            initialCredits: parseInt(individualCredits) || 50,
          },
          maxUses: parseInt(maxUses) || 1,
          expiresInDays: parseInt(expiresInDays) || 30,
        });
      } else {
        // join — needs tenantId
        if (!tenantId) {
          toast.error("No organization selected for join link");
          return;
        }
        createLink.mutate({
          type: "join",
          tenantId,
          metadata: { role: joinRole },
          maxUses: maxUses === "0" ? null : parseInt(maxUses) || null,
          expiresInDays: parseInt(expiresInDays) || 30,
        });
      }
    } else {
      // Create now (existing behavior)
      if (accountType === "firm") {
        const slug = firmName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
        if (!firmName.trim()) {
          toast.error("Firm name is required");
          return;
        }
        provisionFirm.mutate({
          name: firmName.trim(),
          slug: slug || "firm",
          plan,
          seats: parseInt(seats) || 5,
          initialCredits: parseInt(credits) || 0,
          ownerEmail: ownerEmail.trim() || undefined,
          domainLock: domainLock.trim() || undefined,
        });
      } else if (accountType === "individual") {
        if (!individualEmail.trim()) {
          toast.error("Email is required for direct creation");
          return;
        }
        inviteIndividual.mutate({
          email: individualEmail.trim(),
          initialCredits: parseInt(individualCredits) || 50,
        });
      }
    }
  }

  const inviteUrl = generatedToken
    ? `${window.location.origin}/join/${generatedToken}`
    : "";

  function copyLink() {
    navigator.clipboard.writeText(inviteUrl);
    setCopied(true);
    toast.success("Link copied to clipboard");
    setTimeout(() => setCopied(false), 2000);
  }

  const isPending = provisionFirm.isPending || inviteIndividual.isPending || createLink.isPending;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="bg-[#12162a] border-white/10 text-white max-w-md">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold">
            {step === "type" && "Add Account"}
            {step === "details" && (accountType === "firm" ? "New Organization" : accountType === "individual" ? "New Individual" : "Join Link")}
            {step === "result" && "Invite Link Ready"}
          </DialogTitle>
        </DialogHeader>

        {/* Step 1: Choose type */}
        {step === "type" && (
          <div className="space-y-3 mt-2">
            <button
              onClick={() => handleTypeSelect("firm")}
              className="w-full flex items-center gap-4 p-4 rounded-lg border border-white/10 hover:border-amber-500/30 hover:bg-amber-500/5 transition-all text-left"
            >
              <div className="w-10 h-10 rounded-lg bg-amber-500/10 flex items-center justify-center shrink-0">
                <Building2 className="w-5 h-5 text-amber-400" />
              </div>
              <div>
                <p className="font-medium text-white text-sm">Organization</p>
                <p className="text-xs text-slate-400 mt-0.5">Multi-seat firm with shared credits and team management</p>
              </div>
              <ArrowRight className="w-4 h-4 text-slate-500 ml-auto shrink-0" />
            </button>

            <button
              onClick={() => handleTypeSelect("individual")}
              className="w-full flex items-center gap-4 p-4 rounded-lg border border-white/10 hover:border-amber-500/30 hover:bg-amber-500/5 transition-all text-left"
            >
              <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center shrink-0">
                <User className="w-5 h-5 text-blue-400" />
              </div>
              <div>
                <p className="font-medium text-white text-sm">Individual</p>
                <p className="text-xs text-slate-400 mt-0.5">Single-seat account for one person</p>
              </div>
              <ArrowRight className="w-4 h-4 text-slate-500 ml-auto shrink-0" />
            </button>

            {tenantId && (
              <button
                onClick={() => handleTypeSelect("join")}
                className="w-full flex items-center gap-4 p-4 rounded-lg border border-white/10 hover:border-amber-500/30 hover:bg-amber-500/5 transition-all text-left"
              >
                <div className="w-10 h-10 rounded-lg bg-emerald-500/10 flex items-center justify-center shrink-0">
                  <Users className="w-5 h-5 text-emerald-400" />
                </div>
                <div>
                  <p className="font-medium text-white text-sm">Join Link for {tenantName}</p>
                  <p className="text-xs text-slate-400 mt-0.5">Invite someone to join this existing org</p>
                </div>
                <ArrowRight className="w-4 h-4 text-slate-500 ml-auto shrink-0" />
              </button>
            )}
          </div>
        )}

        {/* Step 2: Details */}
        {step === "details" && (
          <div className="space-y-4 mt-2">
            {/* Delivery mode toggle */}
            <div className="flex rounded-lg bg-white/5 p-1">
              <button
                onClick={() => setDeliveryMode("link")}
                className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-all ${
                  deliveryMode === "link"
                    ? "bg-amber-500/20 text-amber-400"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                <Link2 className="w-3.5 h-3.5" />
                Generate Link
              </button>
              {accountType !== "join" && (
                <button
                  onClick={() => setDeliveryMode("create")}
                  className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-all ${
                    deliveryMode === "create"
                      ? "bg-amber-500/20 text-amber-400"
                      : "text-slate-400 hover:text-white"
                  }`}
                >
                  Create Now
                </button>
              )}
            </div>

            {/* Firm details */}
            {accountType === "firm" && (
              <>
                <div className="space-y-1.5">
                  <Label className="text-slate-300 text-sm">Organization Name</Label>
                  <Input
                    value={firmName}
                    onChange={(e) => setFirmName(e.target.value)}
                    placeholder="Acme Design Co"
                    className="bg-white/5 border-white/10 text-white"
                  />
                  {deliveryMode === "link" && (
                    <p className="text-xs text-slate-500">Optional — they can set this during signup</p>
                  )}
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
                  <Label className="text-slate-300 text-sm">Domain Lock (optional)</Label>
                  <Input
                    value={domainLock}
                    onChange={(e) => setDomainLock(e.target.value)}
                    placeholder="acme.com"
                    className="bg-white/5 border-white/10 text-white"
                  />
                </div>

                {deliveryMode === "create" && (
                  <div className="space-y-1.5">
                    <Label className="text-slate-300 text-sm">Owner Email</Label>
                    <Input
                      type="email"
                      value={ownerEmail}
                      onChange={(e) => setOwnerEmail(e.target.value)}
                      placeholder="owner@acme.com"
                      className="bg-white/5 border-white/10 text-white"
                    />
                    <p className="text-xs text-slate-500">User must have signed in at least once.</p>
                  </div>
                )}
              </>
            )}

            {/* Individual details */}
            {accountType === "individual" && (
              <>
                {deliveryMode === "create" && (
                  <div className="space-y-1.5">
                    <Label className="text-slate-300 text-sm">Email</Label>
                    <Input
                      type="email"
                      value={individualEmail}
                      onChange={(e) => setIndividualEmail(e.target.value)}
                      placeholder="designer@example.com"
                      className="bg-white/5 border-white/10 text-white"
                      autoFocus
                    />
                  </div>
                )}

                <div className="space-y-1.5">
                  <Label className="text-slate-300 text-sm">Trial Credits</Label>
                  <Input
                    type="number"
                    value={individualCredits}
                    onChange={(e) => setIndividualCredits(e.target.value)}
                    min="0"
                    className="bg-white/5 border-white/10 text-white"
                  />
                  <p className="text-xs text-slate-500">Granted on account creation. Default: 50.</p>
                </div>
              </>
            )}

            {/* Join details */}
            {accountType === "join" && (
              <div className="space-y-1.5">
                <Label className="text-slate-300 text-sm">Role</Label>
                <select
                  value={joinRole}
                  onChange={(e) => setJoinRole(e.target.value as "admin" | "member")}
                  className="w-full h-9 rounded-md bg-white/5 border border-white/10 text-white text-sm px-3"
                >
                  <option value="member">Member</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
            )}

            {/* Link options */}
            {deliveryMode === "link" && (
              <div className="grid grid-cols-2 gap-3 pt-2 border-t border-white/5">
                <div className="space-y-1.5">
                  <Label className="text-slate-300 text-sm">Max Uses</Label>
                  <Input
                    type="number"
                    value={maxUses}
                    onChange={(e) => setMaxUses(e.target.value)}
                    min="0"
                    className="bg-white/5 border-white/10 text-white"
                  />
                  <p className="text-xs text-slate-500">0 = unlimited</p>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-slate-300 text-sm">Expires In</Label>
                  <select
                    value={expiresInDays}
                    onChange={(e) => setExpiresInDays(e.target.value)}
                    className="w-full h-9 rounded-md bg-white/5 border border-white/10 text-white text-sm px-3"
                  >
                    <option value="7">7 days</option>
                    <option value="14">14 days</option>
                    <option value="30">30 days</option>
                    <option value="90">90 days</option>
                    <option value="365">1 year</option>
                  </select>
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="flex justify-between pt-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setStep("type")}
                className="text-slate-400"
              >
                Back
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={isPending}
                className="bg-gradient-to-r from-amber-500 to-orange-500 text-black font-medium"
              >
                {isPending && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}
                {deliveryMode === "link" ? "Generate Link" : "Create Now"}
              </Button>
            </div>
          </div>
        )}

        {/* Step 3: Result (link generated) */}
        {step === "result" && generatedToken && (
          <div className="space-y-4 mt-2">
            <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 p-4 text-center">
              <Link2 className="w-6 h-6 text-emerald-400 mx-auto mb-2" />
              <p className="text-sm text-emerald-300 font-medium">Invite link created!</p>
              <p className="text-xs text-slate-400 mt-1">Share this link with the recipient.</p>
            </div>

            <div className="flex items-center gap-2">
              <Input
                readOnly
                value={inviteUrl}
                className="bg-white/5 border-white/10 text-white text-xs font-mono"
              />
              <Button
                size="sm"
                variant="outline"
                onClick={copyLink}
                className="shrink-0 border-white/10 text-white hover:bg-white/5"
              >
                {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
              </Button>
            </div>

            <div className="text-xs text-slate-500 space-y-1">
              <p>Type: {accountType} | Max uses: {maxUses === "0" ? "Unlimited" : maxUses} | Expires: {expiresInDays} days</p>
            </div>

            <div className="flex justify-end pt-2">
              <Button
                onClick={handleClose}
                className="bg-gradient-to-r from-amber-500 to-orange-500 text-black font-medium"
              >
                Done
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
