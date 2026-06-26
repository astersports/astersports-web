import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { getLoginUrl } from "@/const";
import { trpc } from "@/lib/trpc";
import {
  ArrowLeft,
  CreditCard,
  DollarSign,
  ExternalLink,
  Link2,
  Loader2,
  Plus,
  RefreshCw,
  Users,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

const LOGO_URL = "/aster-mark.png";

/**
 * Admin Billing Dashboard
 * Owner-only page for managing Stripe billing clients, subscriptions, and payment links.
 */
export default function BillingDashboard() {
  const { user, loading: authLoading } = useAuth();

  if (authLoading) {
    return <BillingSkeleton />;
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-[#0a0e1a] flex items-center justify-center">
        <div className="flex flex-col items-center gap-6 p-8 max-w-md w-full">
          <img src={LOGO_URL} alt="Aster Sports" className="w-12 h-12" />
          <h1 className="text-2xl font-semibold text-white text-center" style={{ fontFamily: "var(--font-display)" }}>
            Admin Access Required
          </h1>
          <p className="text-slate-400 text-center text-sm">
            Sign in with your admin account to access the billing dashboard.
          </p>
          <Button
            onClick={() => { window.location.href = getLoginUrl(); }}
            className="w-full bg-gradient-to-r from-[#f5b731] to-[#e67e22] text-[#0a0e1a] font-semibold hover:opacity-90"
          >
            Sign In
          </Button>
        </div>
      </div>
    );
  }

  // Owner-only: the backend enforces via OWNER_OPEN_ID, but we also gate the UI
  // for non-admin users to avoid showing a confusing error
  if (user.role !== "admin") {
    return (
      <div className="min-h-screen bg-[#0a0e1a] flex items-center justify-center">
        <div className="flex flex-col items-center gap-6 p-8 max-w-md w-full">
          <h1 className="text-2xl font-semibold text-white text-center" style={{ fontFamily: "var(--font-display)" }}>
            Access Denied
          </h1>
          <p className="text-slate-400 text-center text-sm">
            You don't have permission to access this page. Only the site owner can manage billing.
          </p>
          <a href="/" className="text-[#f5b731] hover:underline text-sm">
            Return to homepage
          </a>
        </div>
      </div>
    );
  }

  return <BillingContent />;
}

function BillingContent() {
  const { data, isLoading, error, refetch } = trpc.billing.listClients.useQuery();
  const syncMutation = trpc.billing.syncAll.useMutation({
    onSuccess: (result) => {
      toast.success(`Synced ${result.synced} clients, ${result.updated} updated`);
      refetch();
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <div className="min-h-screen bg-[#0a0e1a] overflow-x-hidden">
      {/* Header */}
      <header className="bg-[#0a0e1a] border-b border-white/5 pt-2">
        <div className="max-w-5xl mx-auto px-4 py-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-3 min-w-0">
              <a href="/" aria-label="Back to Aster Sports" className="inline-flex items-center gap-1 text-slate-400 hover:text-white transition-colors flex-shrink-0">
                <ArrowLeft className="w-5 h-5" aria-hidden="true" /><span className="hidden sm:inline text-sm">Back to Aster Sports</span>
              </a>
              <img src={LOGO_URL} alt="Aster Sports" className="w-8 h-8 flex-shrink-0" />
              <div className="min-w-0">
                <h1 className="text-base sm:text-lg font-semibold text-white truncate" style={{ fontFamily: "var(--font-display)" }}>
                  Dashboard
                </h1>
                <p className="text-xs text-slate-400 truncate">Manage client subscriptions & payments</p>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <Button
                variant="outline"
                size="sm"
                onClick={() => syncMutation.mutate()}
                disabled={syncMutation.isPending}
                className="border-white/10 text-slate-300 hover:text-white hover:border-white/20 bg-transparent"
              >
                {syncMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin sm:mr-2" />
                ) : (
                  <RefreshCw className="w-4 h-4 sm:mr-2" />
                )}
                <span className="hidden sm:inline">Sync</span>
              </Button>
              <CreateClientDialog onSuccess={() => refetch()} />
            </div>
          </div>
        </div>
      </header>

      {/* Stats */}
      <div className="max-w-5xl mx-auto py-8 px-4">
        {error && (
          <div className="mb-6 p-4 rounded-xl border border-red-500/20 bg-red-500/5">
            <p className="text-red-400 text-sm font-medium">Failed to load billing data</p>
            <p className="text-red-400/70 text-xs mt-1">{error.message}</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              className="mt-3 border-red-500/20 text-red-400 hover:bg-red-500/10 bg-transparent text-xs"
            >
              <RefreshCw className="w-3 h-3 mr-1" />
              Retry
            </Button>
          </div>
        )}
        <StatsCards clients={data?.clients ?? []} isLoading={isLoading} />

        <Separator className="my-8 bg-white/5" />

        {/* Client List */}
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold text-white" style={{ fontFamily: "var(--font-display)" }}>
              Clients
            </h2>
            <CreatePaymentLinkDialog />
          </div>

          {isLoading ? (
            <div className="space-y-4">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-24 bg-white/5 rounded-xl" />
              ))}
            </div>
          ) : data?.clients && data.clients.length > 0 ? (
            <div className="space-y-4">
              {data.clients.map((client) => (
                <ClientCard key={client.id} client={client} onUpdate={() => refetch()} />
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Users className="w-12 h-12 text-slate-600 mb-4" />
              <h3 className="text-lg font-medium text-white mb-2" style={{ fontFamily: "var(--font-display)" }}>
                No clients yet
              </h3>
              <p className="text-slate-400 text-sm max-w-sm">
                Add your first billing client to start managing subscriptions and payments.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatsCards({ clients, isLoading }: { clients: any[]; isLoading: boolean }) {
  const activeCount = clients.filter((c) => c.subscriptionStatus === "active").length;
  const totalMRR = activeCount * 300; // $300/month per active sub

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
      <Card className="bg-[#111827]/60 border-white/5">
        <CardHeader className="pb-2">
          <CardDescription className="text-slate-400 text-xs uppercase tracking-wider">Total Clients</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-8 w-16 bg-white/10" />
          ) : (
            <p className="text-3xl font-bold text-white" style={{ fontFamily: "var(--font-display)" }}>
              {clients.length}
            </p>
          )}
        </CardContent>
      </Card>

      <Card className="bg-[#111827]/60 border-white/5">
        <CardHeader className="pb-2">
          <CardDescription className="text-slate-400 text-xs uppercase tracking-wider">Active Subscriptions</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-8 w-16 bg-white/10" />
          ) : (
            <p className="text-3xl font-bold text-[#f5b731]" style={{ fontFamily: "var(--font-display)" }}>
              {activeCount}
            </p>
          )}
        </CardContent>
      </Card>

      <Card className="bg-[#111827]/60 border-white/5">
        <CardHeader className="pb-2">
          <CardDescription className="text-slate-400 text-xs uppercase tracking-wider">Monthly Revenue</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-8 w-24 bg-white/10" />
          ) : (
            <p className="text-3xl font-bold text-emerald-400" style={{ fontFamily: "var(--font-display)" }}>
              ${totalMRR.toLocaleString()}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ClientCard({ client, onUpdate }: { client: any; onUpdate: () => void }) {
  const portalMutation = trpc.billing.createPortalSession.useMutation({
    onSuccess: (data) => {
      window.open(data.url, "_blank");
    },
    onError: (err) => toast.error(err.message),
  });

  const createSubMutation = trpc.billing.createSubscription.useMutation({
    onSuccess: (data) => {
      if (data.checkoutUrl) {
        window.open(data.checkoutUrl, "_blank");
        toast.success("Checkout page opened — send to client to complete payment.");
      } else {
        toast.success("Subscription created");
      }
      onUpdate();
    },
    onError: (err) => toast.error(err.message),
  });

  const statusColor: Record<string, string> = {
    active: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    past_due: "bg-amber-500/10 text-amber-400 border-amber-500/20",
    canceled: "bg-red-500/10 text-red-400 border-red-500/20",
    none: "bg-slate-500/10 text-slate-400 border-slate-500/20",
    incomplete: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  };

  return (
    <Card className="bg-[#111827]/60 border-white/5 hover:border-white/10 transition-colors">
      <CardContent className="p-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 rounded-lg bg-[#f5b731]/10 border border-[#f5b731]/20 flex items-center justify-center flex-shrink-0">
              <CreditCard className="w-5 h-5 text-[#f5b731]" />
            </div>
            <div>
              <h3 className="text-base font-medium text-white" style={{ fontFamily: "var(--font-display)" }}>
                {client.name}
              </h3>
              <p className="text-sm text-slate-400">{client.email}</p>
              {client.notes && (
                <p className="text-xs text-slate-500 mt-1">{client.notes}</p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <Badge
              variant="outline"
              className={statusColor[client.subscriptionStatus] ?? statusColor.none}
            >
              {client.subscriptionStatus === "none" ? "No subscription" : client.subscriptionStatus}
            </Badge>

            {client.subscriptionStatus === "none" && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => createSubMutation.mutate({ clientId: client.id })}
                disabled={createSubMutation.isPending}
                className="border-[#f5b731]/20 text-[#f5b731] hover:bg-[#f5b731]/10 bg-transparent text-xs"
              >
                {createSubMutation.isPending ? (
                  <Loader2 className="w-3 h-3 animate-spin mr-1" />
                ) : (
                  <Plus className="w-3 h-3 mr-1" />
                )}
                Add Sub
              </Button>
            )}

            <Button
              variant="outline"
              size="sm"
              onClick={() => portalMutation.mutate({ clientId: client.id })}
              disabled={portalMutation.isPending}
              className="border-white/10 text-slate-300 hover:text-white hover:border-white/20 bg-transparent text-xs"
            >
              {portalMutation.isPending ? (
                <Loader2 className="w-3 h-3 animate-spin mr-1" />
              ) : (
                <ExternalLink className="w-3 h-3 mr-1" />
              )}
              Portal
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function CreateClientDialog({ onSuccess }: { onSuccess: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [createSub, setCreateSub] = useState(true);

  const mutation = trpc.billing.createClient.useMutation({
    onSuccess: (data) => {
      toast.success("Client created successfully");
      if (data.checkoutUrl) {
        window.open(data.checkoutUrl, "_blank");
        toast.info("Checkout page opened — send this to your client to complete payment.");
      }
      setOpen(false);
      setName("");
      setEmail("");
      setNotes("");
      onSuccess();
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          size="sm"
          className="bg-gradient-to-r from-[#f5b731] to-[#e67e22] text-[#0a0e1a] font-medium hover:opacity-90"
        >
          <Plus className="w-4 h-4 sm:mr-2" />
          <span className="hidden sm:inline">Add Client</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="bg-[#111827] border-white/10 text-white">
        <DialogHeader>
          <DialogTitle className="text-white" style={{ fontFamily: "var(--font-display)" }}>
            Add New Client
          </DialogTitle>
          <DialogDescription className="text-slate-400">
            Create a Stripe customer and optionally start a $300/month subscription.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label className="text-slate-300">Client Name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. St. Patrick's Church"
              className="bg-[#0a0e1a] border-white/10 text-white placeholder:text-slate-500"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-slate-300">Email</Label>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="billing@example.com"
              className="bg-[#0a0e1a] border-white/10 text-white placeholder:text-slate-500"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-slate-300">Notes (optional)</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Any additional notes..."
              className="bg-[#0a0e1a] border-white/10 text-white placeholder:text-slate-500 resize-none"
              rows={2}
            />
          </div>
          <div className="flex items-center gap-3 pt-2">
            <input
              type="checkbox"
              id="create-sub"
              checked={createSub}
              onChange={(e) => setCreateSub(e.target.checked)}
              className="w-4 h-4 rounded border-white/20 bg-[#0a0e1a] accent-[#f5b731]"
            />
            <Label htmlFor="create-sub" className="text-slate-300 text-sm cursor-pointer">
              Create $300/month subscription immediately
            </Label>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => setOpen(false)}
            className="border-white/10 text-slate-300 bg-transparent"
          >
            Cancel
          </Button>
          <Button
            onClick={() => mutation.mutate({ name, email, notes, createSubscription: createSub })}
            disabled={!name || !email || mutation.isPending}
            className="bg-gradient-to-r from-[#f5b731] to-[#e67e22] text-[#0a0e1a] font-medium"
          >
            {mutation.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin mr-2" />
            ) : null}
            Create Client
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CreatePaymentLinkDialog() {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [generatedUrl, setGeneratedUrl] = useState("");

  const mutation = trpc.billing.createPaymentLink.useMutation({
    onSuccess: (data) => {
      setGeneratedUrl(data.url);
      toast.success("Payment link created");
    },
    onError: (err) => toast.error(err.message),
  });

  const handleCreate = () => {
    const cents = Math.round(parseFloat(amount) * 100);
    if (isNaN(cents) || cents < 100) {
      toast.error("Amount must be at least $1.00");
      return;
    }
    mutation.mutate({ amount: cents, description });
  };

  const handleClose = () => {
    setOpen(false);
    setAmount("");
    setDescription("");
    setGeneratedUrl("");
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); else setOpen(true); }}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="border-white/10 text-slate-300 hover:text-white hover:border-white/20 bg-transparent"
        >
          <Link2 className="w-4 h-4 mr-2" />
          Payment Link
        </Button>
      </DialogTrigger>
      <DialogContent className="bg-[#111827] border-white/10 text-white">
        <DialogHeader>
          <DialogTitle className="text-white" style={{ fontFamily: "var(--font-display)" }}>
            Create Payment Link
          </DialogTitle>
          <DialogDescription className="text-slate-400">
            Generate a one-time Stripe payment link to send to a client.
          </DialogDescription>
        </DialogHeader>

        {generatedUrl ? (
          <div className="space-y-4 py-4">
            <div className="p-4 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
              <p className="text-sm text-emerald-400 font-medium mb-2">Payment link created!</p>
              <div className="flex items-center gap-2">
                <Input
                  readOnly
                  value={generatedUrl}
                  className="bg-[#0a0e1a] border-white/10 text-white text-xs"
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    navigator.clipboard.writeText(generatedUrl);
                    toast.success("Copied to clipboard");
                  }}
                  className="border-white/10 text-slate-300 bg-transparent shrink-0"
                >
                  Copy
                </Button>
              </div>
            </div>
            <Button
              variant="outline"
              onClick={handleClose}
              className="w-full border-white/10 text-slate-300 bg-transparent"
            >
              Done
            </Button>
          </div>
        ) : (
          <>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label className="text-slate-300">Amount (USD)</Label>
                <div className="relative">
                  <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                  <Input
                    type="number"
                    step="0.01"
                    min="1"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="300.00"
                    className="bg-[#0a0e1a] border-white/10 text-white placeholder:text-slate-500 pl-9"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label className="text-slate-300">Description</Label>
                <Input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="e.g. Website redesign deposit"
                  className="bg-[#0a0e1a] border-white/10 text-white placeholder:text-slate-500"
                />
              </div>
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                onClick={handleClose}
                className="border-white/10 text-slate-300 bg-transparent"
              >
                Cancel
              </Button>
              <Button
                onClick={handleCreate}
                disabled={!amount || !description || mutation.isPending}
                className="bg-gradient-to-r from-[#f5b731] to-[#e67e22] text-[#0a0e1a] font-medium"
              >
                {mutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                ) : null}
                Generate Link
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function BillingSkeleton() {
  return (
    <div className="min-h-screen bg-[#0a0e1a]">
      <div className="container py-8">
        <Skeleton className="h-8 w-48 bg-white/5 mb-8" />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24 bg-white/5 rounded-xl" />
          ))}
        </div>
        <div className="space-y-4">
          {[1, 2].map((i) => (
            <Skeleton key={i} className="h-20 bg-white/5 rounded-xl" />
          ))}
        </div>
      </div>
    </div>
  );
}
