/**
 * AppShell — Studio layout wrapper with sidebar navigation.
 * Provides consistent nav, tenant selector, and credit balance display.
 */
import { Link, useLocation } from "wouter";
import { useTenant } from "@/contexts/TenantContext";
import { useAuth } from "@/_core/hooks/useAuth";
import {
  Paintbrush,
  History,
  CreditCard,
  Users,
  ChevronLeft,
  Sparkles,
  AlertTriangle,
  BookOpen,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { LOW_BALANCE_THRESHOLD } from "@shared/billing";

const NAV_ITEMS = [
  { href: "/studio", label: "Editor", icon: Paintbrush },
  { href: "/studio/history", label: "History", icon: History },
  { href: "/studio/ledger", label: "Credit Ledger", icon: BookOpen },
  { href: "/studio/billing", label: "Billing", icon: CreditCard },
  { href: "/studio/admin", label: "Admin", icon: Users, adminOnly: true },
];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { tenant, tenants, setActiveTenant } = useTenant();
  const { user } = useAuth();
  const isAdmin = tenant?.role === "owner" || tenant?.role === "admin";

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      {/* Sidebar */}
      <aside className="hidden md:flex w-64 flex-col border-r border-border bg-card">
        {/* Header */}
        <div className="p-4 border-b border-border">
          <Link href="/" className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-3">
            <ChevronLeft className="w-4 h-4" />
            Back to Aster Sports
          </Link>
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-primary" />
            <span className="font-semibold text-lg">Print Studio</span>
          </div>
        </div>

        {/* Tenant selector */}
        {tenants.length > 1 && (
          <div className="p-3 border-b border-border">
            <select
              value={tenant?.id ?? ""}
              onChange={(e) => setActiveTenant(Number(e.target.value))}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            >
              {tenants.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Navigation */}
        <nav className="flex-1 p-3 space-y-1">
          {NAV_ITEMS.filter((item) => !item.adminOnly || isAdmin).map((item) => {
            const isActive = location === item.href || (item.href !== "/studio" && location.startsWith(item.href));
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground"
                }`}
              >
                <Icon className="w-4 h-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* Credit balance */}
        {tenant && (
          <div className="p-4 border-t border-border">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Credits</span>
              <span
                className={`font-semibold tabular-nums ${
                  tenant.creditBalance <= LOW_BALANCE_THRESHOLD
                    ? "text-destructive"
                    : "text-foreground"
                }`}
              >
                {tenant.creditBalance.toLocaleString()}
              </span>
            </div>
            {tenant.creditBalance <= LOW_BALANCE_THRESHOLD && (
              <div className="flex items-center gap-1.5 mt-2 text-xs text-destructive">
                <AlertTriangle className="w-3 h-3" />
                Low balance
              </div>
            )}
          </div>
        )}
      </aside>

      {/* Mobile header */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-40 bg-card border-b border-border">
        <div className="flex items-center justify-between px-4 h-14">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" />
            <span className="font-semibold">Print Studio</span>
          </div>
          {tenant && (
            <span className="text-xs font-medium tabular-nums text-muted-foreground">
              {tenant.creditBalance.toLocaleString()} cr
            </span>
          )}
        </div>
        <nav className="flex border-t border-border overflow-x-auto">
          {NAV_ITEMS.filter((item) => !item.adminOnly || isAdmin).map((item) => {
            const isActive = location === item.href || (item.href !== "/studio" && location.startsWith(item.href));
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium whitespace-nowrap border-b-2 transition-colors ${
                  isActive
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground"
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>

      {/* Main content */}
      <main className="flex-1 min-w-0 md:p-6 p-4 pt-[7.5rem] md:pt-6">
        {children}
      </main>
    </div>
  );
}
