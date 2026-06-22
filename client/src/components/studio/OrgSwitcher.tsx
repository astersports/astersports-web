/**
 * OrgSwitcher — the multi-org context control in the Studio shell. Shows the active
 * org and, for users in more than one, a grouped (Firms / Individuals) dropdown to
 * switch (persisted via TenantContext). Read-only while impersonating. Footer routes
 * to create/manage. Replaces the old bare <select>. (Spec §5.1)
 */
import { useTenant } from "@/contexts/TenantContext";
import { useLocation } from "wouter";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { OrgAvatar } from "./OrgAvatar";
import { Check, ChevronsUpDown, Plus, Settings2 } from "lucide-react";

function roleLabel(role: string) {
  return role.charAt(0).toUpperCase() + role.slice(1);
}

export function OrgSwitcher() {
  const { tenant, tenants, setActiveTenant, isImpersonating } = useTenant();
  const [, navigate] = useLocation();
  if (!tenant) return null;

  const identity = (
    <div className="flex min-w-0 items-center gap-2.5">
      <OrgAvatar name={tenant.name} type={tenant.type} />
      <div className="min-w-0 flex-1 text-left">
        <p className="truncate text-sm font-semibold leading-tight">{tenant.name}</p>
        <p className="truncate text-xs text-muted-foreground">
          {tenant.creditBalance.toLocaleString()} cr · {roleLabel(tenant.role)}
        </p>
      </div>
    </div>
  );

  // While impersonating, the active org is fixed by the server-side session.
  if (isImpersonating) {
    return (
      <div className="flex items-center rounded-lg border border-border bg-card px-3 py-2">{identity}</div>
    );
  }

  const firms = tenants.filter((t) => t.type === "firm");
  const individuals = tenants.filter((t) => t.type === "individual");

  const Row = (t: (typeof tenants)[number]) => (
    <DropdownMenuItem
      key={t.id}
      onClick={() => setActiveTenant(t.id)}
      className="gap-2.5 py-2"
    >
      <OrgAvatar name={t.name} type={t.type} className="h-7 w-7 text-xs" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium leading-tight">{t.name}</p>
        <p className="truncate text-xs text-muted-foreground">
          {t.creditBalance.toLocaleString()} cr · {roleLabel(t.role)}
        </p>
      </div>
      {t.id === tenant.id && <Check className="h-4 w-4 shrink-0 text-primary" />}
    </DropdownMenuItem>
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="flex w-full items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 transition-colors hover:bg-accent"
          aria-label="Switch organization"
        >
          {identity}
          <ChevronsUpDown className="ml-auto h-4 w-4 shrink-0 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        {firms.length > 0 && (
          <>
            <DropdownMenuLabel className="text-xs text-muted-foreground">Firms</DropdownMenuLabel>
            {firms.map(Row)}
          </>
        )}
        {individuals.length > 0 && (
          <>
            {firms.length > 0 && <DropdownMenuSeparator />}
            <DropdownMenuLabel className="text-xs text-muted-foreground">Individual accounts</DropdownMenuLabel>
            {individuals.map(Row)}
          </>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => navigate("/studio/admin?create=1")} className="gap-2">
          <Plus className="h-4 w-4" />
          Create organization
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => navigate("/studio/admin")} className="gap-2">
          <Settings2 className="h-4 w-4" />
          Manage organizations
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default OrgSwitcher;
