/**
 * AppShell — Studio layout wrapper with sidebar navigation.
 * Provides consistent nav, org switcher, and credit balance display.
 */
import { Link, useLocation } from "wouter";
import { useTenant } from "@/contexts/TenantContext";
import { useAuth } from "@/_core/hooks/useAuth";
import {
  Paintbrush,
  History,
  CreditCard,
  Building2,
  ChevronLeft,
  Sparkles,
  AlertTriangle,
  BookOpen,
  Shield,
} from "lucide-react";
import { LOW_BALANCE_THRESHOLD } from "@shared/billing";
import { TrialBanner } from "./TrialBanner";
import OrgSwitcher from "./OrgSwitcher";

const NAV_ITEMS = [
  { href: "/studio", label: "Editor", icon: Paintbrush },
  { href: "/studio/history", label: "History", icon: History },
  { href: "/studio/ledger", label: "Credit Ledger", icon: BookOpen },
  { href: "/studio/billing", label: "Billing", icon: CreditCard },
  { href: "/studio/admin", label: "Organizations", icon: Building2 },
];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { tenant } = useTenant();
  const { user } = useAuth();
  // Super_admin: platform owner (role=admin + matching openId). Keeps the
  // Platform Console entry point (org checkpoint 2c00e38).
  const isSuperAdmin = user?.role === "admin" && user?.openId === import.meta.env.VITE_OWNER_OPEN_ID;

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

        {/* Org switcher */}
        {tenant && (
          <div className="p-3 border-b border-border">
            <OrgSwitcher />
          </div>
        )}

        {/* Navigation */}
        <nav className="flex-1 p-3 space-y-1">
          {NAV_ITEMS.map((item) => {
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

        {/* Platform Console link (super_admin only) */}
        {isSuperAdmin && (
          <div className="px-3 pb-1">
            <Link
              href="/platform"
              className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors text-amber-500 hover:bg-amber-500/10"
            >
              <Shield className="w-4 h-4" />
              Platform Console
            </Link>
          </div>
        )}

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
        <div className="flex items-center gap-2 px-3 h-14">
          <Sparkles className="w-4 h-4 shrink-0 text-primary" />
          {tenant ? (
            <div className="min-w-0 flex-1">
              <OrgSwitcher />
            </div>
          ) : (
            <span className="font-semibold">Print Studio</span>
          )}
        </div>
        <nav className="flex border-t border-border overflow-x-auto">
          {NAV_ITEMS.map((item) => {
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
          {isSuperAdmin && (
            <Link
              href="/platform"
              className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium whitespace-nowrap border-b-2 transition-colors ${
                location === "/platform"
                  ? "border-amber-500 text-amber-500"
                  : "border-transparent text-amber-500/70"
              }`}
            >
              <Shield className="w-3.5 h-3.5" />
              Platform
            </Link>
          )}
        </nav>
      </div>

      {/* Main content */}
      <main className="flex-1 min-w-0 md:p-6 p-4 pt-[7.5rem] md:pt-6">
        {tenant && <TrialBanner tenantId={tenant.id} />}
        {children}
      </main>
    </div>
  );
}
