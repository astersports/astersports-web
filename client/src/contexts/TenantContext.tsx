/**
 * TenantContext — provides the active tenant + membership to all Studio pages.
 * Handles tenant selection, loading states, and access denial.
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
}

const TenantContext = createContext<TenantContextValue>({
  tenant: null,
  tenants: [],
  setActiveTenant: () => {},
  isLoading: true,
  error: null,
});

export function TenantProvider({ children }: { children: ReactNode }) {
  const { user, isAuthenticated } = useAuth();
  const [activeTenantId, setActiveTenantId] = useState<number | null>(null);

  const { data: tenants, isLoading, error } = trpc.tenants.myTenants.useQuery(
    undefined,
    { enabled: isAuthenticated }
  );

  // Auto-select first tenant
  useEffect(() => {
    if (tenants && tenants.length > 0 && !activeTenantId) {
      setActiveTenantId(tenants[0].id);
    }
  }, [tenants, activeTenantId]);

  const activeTenant = tenants?.find((t) => t.id === activeTenantId) ?? null;

  return (
    <TenantContext.Provider
      value={{
        tenant: activeTenant as TenantWithRole | null,
        tenants: (tenants ?? []) as TenantWithRole[],
        setActiveTenant: setActiveTenantId,
        isLoading,
        error: error?.message ?? null,
      }}
    >
      {children}
    </TenantContext.Provider>
  );
}

export function useTenant() {
  return useContext(TenantContext);
}
