/**
 * TenantContext — provides the active tenant + membership to all Studio pages.
 * Handles tenant selection, loading states, access denial, and impersonation.
 *
 * When a super_admin is impersonating (server-side JWT cookie), the context
 * auto-selects the impersonated tenant. The tenantProcedure middleware on the
 * server grants synthetic owner access, so all queries work transparently.
 */
import { createContext, useContext, useState, useEffect, type ReactNode } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";

interface TenantWithRole {
  id: number;
  name: string;
  slug: string;
  categoryId: number;
  plan: string;
  type: "firm" | "individual";
  creditBalance: number;
  seats: number;
  allowedEmailDomain: string | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  role: string;
}

interface TenantContextValue {
  tenant: TenantWithRole | null;
  tenants: TenantWithRole[];
  setActiveTenant: (id: number) => void;
  isLoading: boolean;
  error: string | null;
  isImpersonating: boolean;
}

const TenantContext = createContext<TenantContextValue>({
  tenant: null,
  tenants: [],
  setActiveTenant: () => {},
  isLoading: true,
  error: null,
  isImpersonating: false,
});

export function TenantProvider({ children }: { children: ReactNode }) {
  const { user, isAuthenticated } = useAuth();
  const [activeTenantId, setActiveTenantId] = useState<number | null>(null);

  // Check impersonation status
  const { data: impersonation } = trpc.platform.impersonationStatus.useQuery(
    undefined,
    { enabled: isAuthenticated, refetchOnWindowFocus: false, retry: false }
  );

  const { data: tenants, isLoading, error } = trpc.tenants.myTenants.useQuery(
    undefined,
    { enabled: isAuthenticated }
  );

  // Auto-select: impersonated tenant takes priority, then first owned tenant
  useEffect(() => {
    if (impersonation?.active) {
      setActiveTenantId(impersonation.tenantId);
      return;
    }
    if (tenants && tenants.length > 0 && !activeTenantId) {
      setActiveTenantId(tenants[0].id);
    }
  }, [tenants, activeTenantId, impersonation]);

  // When impersonating, the tenant might not be in `myTenants` (no real membership).
  // Build a synthetic entry from the impersonation data + any matching tenant from the list.
  const isImpersonating = impersonation?.active ?? false;

  let activeTenant: TenantWithRole | null = null;
  if (activeTenantId && tenants) {
    activeTenant = tenants.find((t) => t.id === activeTenantId) ?? null;
  }

  // If impersonating and tenant not in list, create a minimal synthetic entry
  // The actual data will be fetched by individual components via their own queries
  if (isImpersonating && !activeTenant && impersonation?.active) {
    activeTenant = {
      id: impersonation.tenantId,
      name: impersonation.tenantName,
      slug: "",
      categoryId: 0,
      plan: "",
      type: "firm",
      creditBalance: 0,
      seats: 0,
      allowedEmailDomain: null,
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      role: "owner", // Synthetic owner access
    };
  }

  return (
    <TenantContext.Provider
      value={{
        tenant: activeTenant,
        tenants: (tenants ?? []) as TenantWithRole[],
        setActiveTenant: setActiveTenantId,
        isLoading,
        error: error?.message ?? null,
        isImpersonating,
      }}
    >
      {children}
    </TenantContext.Provider>
  );
}

export function useTenant() {
  return useContext(TenantContext);
}
