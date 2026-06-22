/**
 * /join/:token — Self-service invite link redemption page.
 * Handles three flows:
 *   - "firm": Creates a new organization for the user
 *   - "individual": Creates a solo account for the user
 *   - "join": Adds the user to an existing organization
 *
 * If the user is not authenticated, they are redirected to login first,
 * then returned here to complete redemption.
 */
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getLoginUrl } from "@/const";
import { useRoute } from "wouter";
import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Building2,
  User,
  Users,
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  ArrowRight,
} from "lucide-react";

export default function JoinPage() {
  const [, params] = useRoute("/join/:token");
  const token = params?.token ?? "";
  const { user, loading: authLoading, isAuthenticated } = useAuth();
  const [redeemed, setRedeemed] = useState(false);
  const [redeemError, setRedeemError] = useState<string | null>(null);
  // Firm links only: the new owner can name their org before accepting.
  const [orgName, setOrgName] = useState("");

  // Fetch link details. Public query (no auth gate) so the recipient can preview
  // what they're accepting before being sent through OAuth.
  const { data: link, isLoading: linkLoading, error: linkError } = trpc.inviteLinks.getByToken.useQuery(
    { token },
    { enabled: !!token, retry: false }
  );

  const redeemMutation = trpc.inviteLinks.redeem.useMutation({
    onSuccess: () => setRedeemed(true),
    onError: (err) => setRedeemError(err.message),
  });

  // Seed the org-name field from the link's preset (firm links only), exactly
  // once. A ref guard (rather than reading orgName) keeps the dependency list
  // complete and still lets the user clear the field freely afterward.
  const orgNameSeeded = useRef(false);
  useEffect(() => {
    if (orgNameSeeded.current || link?.type !== "firm") return;
    const preset = (link.metadata as Record<string, any> | null)?.firmName;
    if (preset) setOrgName(String(preset));
    orgNameSeeded.current = true;
  }, [link]);

  // ─── Loading state ──────────────────────────────────────────────────────────
  if (authLoading || linkLoading) {
    return (
      <div className="min-h-screen bg-[#0a0e1a] flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-8 h-8 animate-spin text-[#f5b731]" />
          <p className="text-slate-400 text-sm">Loading invite...</p>
        </div>
      </div>
    );
  }

  // ─── Link error (not found) ─────────────────────────────────────────────────
  if (linkError) {
    return (
      <div className="min-h-screen bg-[#0a0e1a] flex items-center justify-center p-4">
        <Card className="w-full max-w-md bg-[#141926] border-white/10">
          <CardHeader className="text-center">
            <div className="mx-auto w-12 h-12 rounded-full bg-red-500/10 flex items-center justify-center mb-3">
              <XCircle className="w-6 h-6 text-red-400" />
            </div>
            <CardTitle className="text-white text-xl">Invalid Invite Link</CardTitle>
            <CardDescription className="text-slate-400">
              This invite link doesn't exist or may have been removed.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  // ─── Link expired or fully used ────────────────────────────────────────────
  if (link && (link.status === "expired" || link.status === "revoked" || link.status === "redeemed")) {
    const statusConfig = {
      expired: { icon: Clock, label: "Expired", desc: "This invite link has expired and is no longer valid." },
      revoked: { icon: XCircle, label: "Revoked", desc: "This invite link has been revoked by the administrator." },
      redeemed: { icon: CheckCircle2, label: "Already Used", desc: "This invite link has already been used and has reached its limit." },
    };
    const config = statusConfig[link.status as keyof typeof statusConfig];
    const Icon = config.icon;

    return (
      <div className="min-h-screen bg-[#0a0e1a] flex items-center justify-center p-4">
        <Card className="w-full max-w-md bg-[#141926] border-white/10">
          <CardHeader className="text-center">
            <div className="mx-auto w-12 h-12 rounded-full bg-amber-500/10 flex items-center justify-center mb-3">
              <Icon className="w-6 h-6 text-amber-400" />
            </div>
            <CardTitle className="text-white text-xl">{config.label}</CardTitle>
            <CardDescription className="text-slate-400">{config.desc}</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  // ─── Successfully redeemed ──────────────────────────────────────────────────
  if (redeemed) {
    return (
      <div className="min-h-screen bg-[#0a0e1a] flex items-center justify-center p-4">
        <Card className="w-full max-w-md bg-[#141926] border-white/10">
          <CardHeader className="text-center">
            <div className="mx-auto w-12 h-12 rounded-full bg-emerald-500/10 flex items-center justify-center mb-3">
              <CheckCircle2 className="w-6 h-6 text-emerald-400" />
            </div>
            <CardTitle className="text-white text-xl">You're all set!</CardTitle>
            <CardDescription className="text-slate-400">
              {link?.type === "join"
                ? `You've joined ${link.tenantName ?? "the organization"} successfully.`
                : link?.type === "firm"
                ? "Your organization has been created. You're the owner."
                : "Your account has been created successfully."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <Button
              className="w-full bg-gradient-to-r from-[#f5b731] to-[#e67e22] text-[#0a0e1a] font-semibold hover:opacity-90"
              onClick={() => (window.location.href = "/studio")}
            >
              Go to Print Studio
              <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
            {link?.type === "firm" && (
              // New firm owners land with an empty team — send them straight to
              // the admin invite surface so they can bring their members in.
              <Button
                variant="outline"
                className="w-full border-white/15 bg-transparent text-slate-200 hover:bg-white/5"
                onClick={() => (window.location.href = "/studio/admin")}
              >
                <Users className="w-4 h-4 mr-2" />
                Invite your team
              </Button>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  // ─── Ready to redeem — show invite details ──────────────────────────────────
  if (!link) return null;

  const metadata = (link.metadata ?? {}) as Record<string, any>;
  const typeConfig = {
    firm: {
      icon: Building2,
      title: "Organization Invite",
      desc: metadata.firmName
        ? `You've been invited to create and manage "${metadata.firmName}".`
        : "You've been invited to create a new organization.",
      details: [
        metadata.plan && metadata.plan !== "none" ? `Plan: ${metadata.plan}` : null,
        metadata.seats ? `Seats: ${metadata.seats}` : null,
        metadata.initialCredits ? `Starting credits: ${metadata.initialCredits}` : null,
      ].filter(Boolean),
      buttonText: "Create Organization",
    },
    individual: {
      icon: User,
      title: "Account Invite",
      desc: "You've been invited to create a Print Studio account.",
      details: [
        metadata.initialCredits ? `Starting credits: ${metadata.initialCredits}` : null,
      ].filter(Boolean),
      buttonText: "Create Account",
    },
    join: {
      icon: Users,
      title: "Team Invite",
      desc: link.tenantName
        ? `You've been invited to join "${link.tenantName}".`
        : "You've been invited to join an organization.",
      details: [
        metadata.role ? `Role: ${metadata.role}` : null,
      ].filter(Boolean),
      buttonText: "Join Team",
    },
  };

  const config = typeConfig[link.type];
  const Icon = config.icon;

  return (
    <div className="min-h-screen bg-[#0a0e1a] flex items-center justify-center p-4">
      <Card className="w-full max-w-md bg-[#141926] border-white/10">
        <CardHeader className="text-center">
          <div className="mx-auto w-12 h-12 rounded-full bg-[#f5b731]/10 flex items-center justify-center mb-3">
            <Icon className="w-6 h-6 text-[#f5b731]" />
          </div>
          <CardTitle className="text-white text-xl">{config.title}</CardTitle>
          <CardDescription className="text-slate-400">{config.desc}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Details */}
          {config.details.length > 0 && (
            <div className="rounded-lg bg-white/5 border border-white/10 p-3 space-y-1">
              {config.details.map((detail, i) => (
                <p key={i} className="text-sm text-slate-300">{detail}</p>
              ))}
            </div>
          )}

          {/* Org naming (firm links only) — let the new owner name their org. */}
          {isAuthenticated && link.type === "firm" && (
            <div className="space-y-1.5">
              <Label htmlFor="orgName" className="text-xs text-slate-400">Organization name</Label>
              <Input
                id="orgName"
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
                placeholder={metadata.firmName || "Your organization name"}
                maxLength={255}
                className="bg-[#0a0e1a] border-white/10 text-white placeholder:text-slate-500"
              />
            </div>
          )}

          {/* Signed in as */}
          {isAuthenticated && (
            <div className="rounded-lg bg-white/5 border border-white/10 p-3">
              <p className="text-xs text-slate-500 mb-1">Signed in as</p>
              <p className="text-sm text-white font-medium">{user?.name || user?.email || "User"}</p>
              {user?.email && <p className="text-xs text-slate-400">{user.email}</p>}
            </div>
          )}

          {/* Error */}
          {redeemError && (
            <div className="rounded-lg bg-red-500/10 border border-red-500/20 p-3">
              <p className="text-sm text-red-400">{redeemError}</p>
            </div>
          )}

          {/* Accept button (authed) or sign-in CTA (anonymous preview) */}
          {isAuthenticated ? (
            <Button
              className="w-full bg-gradient-to-r from-[#f5b731] to-[#e67e22] text-[#0a0e1a] font-semibold hover:opacity-90"
              disabled={redeemMutation.isPending}
              onClick={() => {
                setRedeemError(null);
                const trimmed = orgName.trim();
                redeemMutation.mutate({
                  token,
                  ...(link.type === "firm" && trimmed ? { orgName: trimmed } : {}),
                });
              }}
            >
              {redeemMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  {config.buttonText}
                  <ArrowRight className="w-4 h-4 ml-2" />
                </>
              )}
            </Button>
          ) : (
            <Button
              className="w-full bg-gradient-to-r from-[#f5b731] to-[#e67e22] text-[#0a0e1a] font-semibold hover:opacity-90"
              onClick={() => {
                // Return here after OAuth to complete the redemption.
                sessionStorage.setItem("join_return", `/join/${token}`);
                window.location.href = getLoginUrl();
              }}
            >
              Sign in to accept
              <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          )}

          {/* Expiry info */}
          {link.expiresAt && (
            <p className="text-xs text-slate-500 text-center">
              This link expires {new Date(link.expiresAt).toLocaleDateString()}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
