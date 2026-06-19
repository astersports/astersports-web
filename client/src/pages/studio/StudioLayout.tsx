/**
 * StudioLayout — wraps all /studio/* routes.
 * Gates access: requires login + active tenant membership.
 * Provides TenantContext and AppShell.
 */
import { useAuth } from "@/_core/hooks/useAuth";
import { TenantProvider, useTenant } from "@/contexts/TenantContext";
import AppShell from "@/components/studio/AppShell";
import { Button } from "@/components/ui/button";
import { Loader2, Lock, LogIn } from "lucide-react";
import { getLoginUrl } from "@/const";
import { Link } from "wouter";

function AccessGate({ children }: { children: React.ReactNode }) {
  const { user, loading: authLoading, isAuthenticated } = useAuth();
  const { tenant, tenants, isLoading: tenantLoading, error } = useTenant();

  // Auth loading
  if (authLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // Not logged in
  if (!isAuthenticated) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-background text-foreground gap-4">
        <Lock className="h-12 w-12 text-muted-foreground" />
        <h1 className="text-2xl font-bold">Print Studio</h1>
        <p className="text-muted-foreground text-center max-w-sm">
          Sign in to access the Print Studio. Access is restricted to authorized team members.
        </p>
        <Button asChild>
          <a href={getLoginUrl()}>
            <LogIn className="mr-2 h-4 w-4" />
            Sign In
          </a>
        </Button>
        <Link href="/" className="text-sm text-muted-foreground hover:text-foreground mt-2">
          ← Back to Aster Sports
        </Link>
      </div>
    );
  }

  // Tenant loading
  if (tenantLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // No tenant membership
  if (!tenant && tenants.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-background text-foreground gap-4">
        <Lock className="h-12 w-12 text-muted-foreground" />
        <h1 className="text-2xl font-bold">Access Restricted</h1>
        <p className="text-muted-foreground text-center max-w-sm">
          You don't have access to any Print Studio workspace. Contact your team admin to get an invitation.
        </p>
        <p className="text-xs text-muted-foreground">
          Signed in as {user?.email}
        </p>
        <Link href="/" className="text-sm text-muted-foreground hover:text-foreground mt-2">
          ← Back to Aster Sports
        </Link>
      </div>
    );
  }

  return <AppShell>{children}</AppShell>;
}

export default function StudioLayout({ children }: { children: React.ReactNode }) {
  return (
    <TenantProvider>
      <AccessGate>{children}</AccessGate>
    </TenantProvider>
  );
}
