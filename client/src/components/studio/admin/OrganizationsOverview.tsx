/**
 * OrganizationsOverview — Zone A of Studio Admin (spec §5.2). A grid of every org
 * the user belongs to (firms + individuals), with role/plan/seats/balance and
 * Switch / Manage / Billing actions. Search appears once the user has several orgs.
 * "Create organization" opens the confirm-gated CreateOrgDialog (auto-opens on
 * ?create=1, the route the OrgSwitcher uses).
 */
import { useEffect, useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { useTenant } from "@/contexts/TenantContext";
import { useLocation, useSearch } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { OrgAvatar } from "../OrgAvatar";
import { TypeBadge, RoleBadge } from "../badges";
import { CreateOrgDialog } from "./CreateOrgDialog";
import { LOW_BALANCE_THRESHOLD } from "@shared/billing";
import { cn } from "@/lib/utils";
import { paginate } from "@shared/paginate";
import { Plus, Search, Check, Settings2, CreditCard, Users, ChevronLeft, ChevronRight } from "lucide-react";

type Org = {
  id: number;
  name: string;
  type: "firm" | "individual";
  role: string;
  plan: string;
  seats: number;
  creditBalance: number;
  memberCount: number;
};

const SEARCH_THRESHOLD = 6;
const PAGE_SIZE = 6;

export function OrganizationsOverview({ onManage }: { onManage?: () => void }) {
  const { tenant, setActiveTenant } = useTenant();
  const [, navigate] = useLocation();
  const search = useSearch();
  const { data, isLoading } = trpc.tenants.overview.useQuery();
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);

  // Auto-open the create dialog when routed here via ?create=1 (OrgSwitcher).
  // Reacts to querystring changes so it fires even when already mounted on this page.
  useEffect(() => {
    if (new URLSearchParams(search).get("create") === "1") setCreateOpen(true);
  }, [search]);

  // Reset to the first page whenever the search narrows the list.
  useEffect(() => { setPage(1); }, [query]);

  const orgs = (data ?? []) as Org[];
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return orgs;
    return orgs.filter((o) => o.name.toLowerCase().includes(q) || o.type.includes(q));
  }, [orgs, query]);
  const paged = paginate(filtered, page, PAGE_SIZE);

  const manage = (id: number) => {
    setActiveTenant(id);
    onManage?.();
  };

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Your organizations</h2>
          <p className="text-sm text-muted-foreground">
            {orgs.length} {orgs.length === 1 ? "organization" : "organizations"} you belong to
          </p>
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)} className="gap-1.5">
          <Plus className="h-4 w-4" />
          <span className="hidden sm:inline">Create organization</span>
          <span className="sm:hidden">Create</span>
        </Button>
      </div>

      {orgs.length > SEARCH_THRESHOLD && (
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search organizations…"
            className="pl-9"
          />
        </div>
      )}

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-28 w-full rounded-xl" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            {orgs.length === 0
              ? "You don't belong to any organizations yet."
              : "No organizations match your search."}
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {paged.rows.map((o) => {
            const active = o.id === tenant?.id;
            const low = o.creditBalance <= LOW_BALANCE_THRESHOLD;
            return (
              <Card
                key={o.id}
                className={cn("transition-colors", active && "ring-1 ring-primary border-primary/40")}
              >
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-start gap-3">
                    <OrgAvatar name={o.name} type={o.type} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate font-semibold">{o.name}</p>
                        {active && (
                          <span className="inline-flex items-center gap-0.5 text-xs text-primary">
                            <Check className="h-3 w-3" /> Active
                          </span>
                        )}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        <TypeBadge type={o.type} />
                        <RoleBadge role={o.role} />
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground capitalize">
                      {o.plan && o.plan !== "none" ? o.plan : "Trial"}
                      {o.type === "firm" && (
                        <span className="ml-2 inline-flex items-center gap-1">
                          <Users className="h-3.5 w-3.5" />
                          {o.memberCount}/{o.seats}
                        </span>
                      )}
                    </span>
                    <span className={cn("font-semibold tabular-nums", low && "text-destructive")}>
                      {o.creditBalance.toLocaleString()} cr
                    </span>
                  </div>

                  <div className="flex gap-2">
                    {!active && (
                      <Button size="sm" variant="outline" className="flex-1" onClick={() => setActiveTenant(o.id)}>
                        Switch
                      </Button>
                    )}
                    <Button size="sm" variant={active ? "default" : "outline"} className="flex-1 gap-1.5" onClick={() => manage(o.id)}>
                      <Settings2 className="h-3.5 w-3.5" />
                      Manage
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => { setActiveTenant(o.id); navigate("/studio/billing"); }} title="Billing">
                      <CreditCard className="h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Pager — keeps the grid short no matter how many orgs the user is in. */}
      {paged.pageCount > 1 && (
        <div className="flex items-center justify-between pt-1">
          <p className="text-xs text-muted-foreground">
            {paged.start + 1}–{paged.start + paged.rows.length} of {paged.total}
          </p>
          <div className="flex items-center gap-2">
            <Button aria-label="Previous page" size="sm" variant="outline" disabled={paged.page <= 1} onClick={() => setPage((p) => p - 1)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-xs text-muted-foreground tabular-nums">
              {paged.page} / {paged.pageCount}
            </span>
            <Button aria-label="Next page" size="sm" variant="outline" disabled={paged.page >= paged.pageCount} onClick={() => setPage((p) => p + 1)}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      <CreateOrgDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={(id) => manage(id)} />
    </section>
  );
}

export default OrganizationsOverview;
