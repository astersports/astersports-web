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
  type: "firm" | "individual";
  plan: string;
  creditBalance: number;
  seats: number;
  allowedEmailDomain: string | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  role: string;
}

/** Persist the selected org across reloads so a multi-org user stays put. */
const ACTIVE_TENANT_KEY = "studio.activeTenantId";
function readStoredTenantId(): number | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(ACTIVE_TENANT_KEY);
  const id = raw ? Number(raw) : NaN;
  return Number.isFinite(id) ? id : null;
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
  const { isAuthenticated } = useAuth();
  const [activeTenantId, setActiveTenantIdState] = useState<number | null>(() => readStoredTenantId());

  // Write-through setter so a manual switch survives reloads.
  const setActiveTenant = (id: number) => {
    setActiveTenantIdState(id);
    if (typeof window !== "undefined") window.localStorage.setItem(ACTIVE_TENANT_KEY, String(id));
  };

  // Check impersonation status
  const { data: impersonation } = trpc.platform.impersonationStatus.useQuery(
    undefined,
    { enabled: isAuthenticated, refetchOnWindowFocus: false, retry: false }
  );

  const { data: tenants, isLoading, error } = trpc.tenants.myTenants.useQuery(
    undefined,
    { enabled: isAuthenticated }
  );

  // `activeTenantId` is the USER's persisted selection and is never overwritten by
  // impersonation — keep it valid against memberships, else fall back to the first
  // org. Impersonation only overrides the *effective* org (below), so ending
  // impersonation cleanly reverts to this stored choice.
  useEffect(() => {
    if (impersonation?.active) return; // don't touch the persisted selection
    if (!tenants || tenants.length === 0) return;
    const valid = activeTenantId != null && tenants.some((t) => t.id === activeTenantId);
    if (!valid) setActiveTenant(tenants[0].id);
  }, [tenants, activeTenantId, impersonation]);

  const isImpersonating = impersonation?.active ?? false;

  // Effective org: impersonation wins; otherwise the persisted selection. When
  // impersonating, the tenant may not be in `myTenants` (no real membership), so a
  // synthetic entry is built below.
  const effectiveId = isImpersonating ? impersonation!.tenantId : activeTenantId;

  let activeTenant: TenantWithRole | null = null;
  if (effectiveId != null && tenants) {
    activeTenant = tenants.find((t) => t.id === effectiveId) ?? null;
  }

  // If impersonating and tenant not in list, create a minimal synthetic entry
  // The actual data will be fetched by individual components via their own queries
  if (isImpersonating && !activeTenant && impersonation?.active) {
    activeTenant = {
      id: impersonation.tenantId,
      name: impersonation.tenantName,
      slug: "",
      categoryId: 0,
      type: "firm",
      plan: "",
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
        setActiveTenant,
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
