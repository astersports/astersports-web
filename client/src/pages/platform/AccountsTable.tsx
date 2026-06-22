/**
 * AccountsTable — unified, searchable/filterable/sortable view of every account
 * (replaces the rigid Firms/Individuals tabs; type is a filter chip now).
 * Row actions: Manage (detail drawer) + Impersonate. (Spec §16.2)
 *
 * Port note: the org repo's `platform.listAccounts` returns `{ accounts, total }`
 * (paginated/searchable server-side), not a bare array. We pull the page array off
 * `.accounts` and keep the client-side sort + 12/row pager (PR #6) on top.
 */
import { useEffect, useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Eye, Loader2, Inbox, Search, Settings2, ArrowUpDown, ChevronLeft, ChevronRight } from "lucide-react";
import { TypePill, PlanPill, StatusPill } from "./pills";
import { paginate } from "@shared/paginate";

type SortKey = "name" | "balance" | "members" | "created";
type TypeFilter = "all" | "firm" | "individual";

const PAGE_SIZE = 12;

export default function AccountsTable({ onManage }: { onManage: (tenantId: number) => void }) {
  // Pull a generous page; client-side filter/sort/paginate on top (spec §16.2 + PR #6).
  const { data, isLoading } = trpc.platform.listAccounts.useQuery({ type: "all", limit: 200 });
  const accounts = data?.accounts;
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("created");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);

  const impersonate = trpc.platform.impersonate.useMutation({
    onSuccess: (data) => {
      toast.success(`Viewing as ${data.tenantName}`, { description: "Redirecting…" });
      window.location.href = "/studio";
    },
    onError: (err) => toast.error(err.message),
  });

  const rows = useMemo(() => {
    let list = (accounts ?? []) as any[];
    if (typeFilter !== "all") list = list.filter((a) => a.type === typeFilter);
    const q = query.trim().toLowerCase();
    if (q) list = list.filter((a) => a.name.toLowerCase().includes(q) || (a.ownerEmail ?? "").toLowerCase().includes(q));
    const dir = sortDir === "asc" ? 1 : -1;
    list = [...list].sort((a, b) => {
      switch (sortKey) {
        case "name": return a.name.localeCompare(b.name) * dir;
        case "balance": return (a.creditBalance - b.creditBalance) * dir;
        case "members": return (a.activeMembers - b.activeMembers) * dir;
        default: return (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()) * dir;
      }
    });
    return list;
  }, [accounts, typeFilter, query, sortKey, sortDir]);

  const paged = paginate(rows, page, PAGE_SIZE);
  // Reset to page 1 when the search / type filter / sort changes.
  useEffect(() => { setPage(1); }, [query, typeFilter, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir(key === "name" ? "asc" : "desc"); }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-6 h-6 animate-spin text-amber-500" />
      </div>
    );
  }

  const chips: { v: TypeFilter; label: string }[] = [
    { v: "all", label: "All" },
    { v: "firm", label: "Firms" },
    { v: "individual", label: "Individuals" },
  ];

  return (
    <div className="space-y-3">
      {/* Controls */}
      <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name or owner email…"
            className="pl-9 bg-white/[0.03] border-white/10 text-white placeholder:text-slate-500"
          />
        </div>
        <div className="inline-flex rounded-lg bg-white/5 p-1">
          {chips.map((c) => (
            <button
              key={c.v}
              onClick={() => setTypeFilter(c.v)}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                typeFilter === c.v ? "bg-amber-500/20 text-amber-400" : "text-slate-400 hover:text-white"
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Inbox className="w-12 h-12 text-slate-600 mb-4" />
          <p className="text-slate-400">No accounts match.</p>
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden md:block rounded-xl border border-white/5 bg-white/[0.02] overflow-hidden">
            <div className="grid grid-cols-[1fr_110px_90px_110px_90px_90px] gap-4 px-4 py-3 border-b border-white/5 text-xs font-medium text-slate-400 uppercase tracking-wider">
              <button className="flex items-center gap-1 hover:text-white" onClick={() => toggleSort("name")}>Account <ArrowUpDown className="w-3 h-3" /></button>
              <span>Plan</span>
              <button className="flex items-center gap-1 hover:text-white" onClick={() => toggleSort("members")}>Seats <ArrowUpDown className="w-3 h-3" /></button>
              <button className="flex items-center gap-1 justify-end hover:text-white" onClick={() => toggleSort("balance")}>Balance <ArrowUpDown className="w-3 h-3" /></button>
              <span>Status</span>
              <span className="text-right">Actions</span>
            </div>
            {paged.rows.map((a) => (
              <div key={a.id} className="grid grid-cols-[1fr_110px_90px_110px_90px_90px] gap-4 px-4 py-3 border-b border-white/5 last:border-0 items-center hover:bg-white/[0.02] transition-colors">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <TypePill type={a.type} />
                    <span className="font-medium text-white truncate">{a.name}</span>
                  </div>
                  {a.ownerEmail && <p className="text-xs text-slate-500 mt-0.5 truncate">{a.ownerEmail}</p>}
                </div>
                <div><PlanPill plan={a.plan} /></div>
                <span className="text-sm text-slate-300">{a.activeMembers}/{a.seats}</span>
                <span className="text-sm text-right font-mono text-amber-400">{a.creditBalance.toLocaleString()}</span>
                <div><StatusPill plan={a.plan} hasTrial={!!a.trialStartedAt} /></div>
                <div className="flex justify-end gap-1">
                  <Button variant="ghost" size="sm" className="text-slate-400 hover:text-amber-400 p-1.5" title="Impersonate" disabled={impersonate.isPending} onClick={() => impersonate.mutate({ tenantId: a.id })}>
                    <Eye className="w-4 h-4" />
                  </Button>
                  <Button variant="ghost" size="sm" className="text-slate-400 hover:text-white p-1.5" title="Manage" onClick={() => onManage(a.id)}>
                    <Settings2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>

          {/* Mobile cards */}
          <div className="md:hidden space-y-3">
            {paged.rows.map((a) => (
              <div key={a.id} className="rounded-xl border border-white/5 bg-white/[0.02] p-4">
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <TypePill type={a.type} />
                    <span className="font-medium text-white truncate">{a.name}</span>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <Button variant="ghost" size="sm" className="text-slate-400 hover:text-amber-400 p-1.5" disabled={impersonate.isPending} onClick={() => impersonate.mutate({ tenantId: a.id })}><Eye className="w-4 h-4" /></Button>
                    <Button variant="ghost" size="sm" className="text-slate-400 hover:text-white p-1.5" onClick={() => onManage(a.id)}><Settings2 className="w-4 h-4" /></Button>
                  </div>
                </div>
                {a.ownerEmail && <p className="text-xs text-slate-500 mb-2 truncate">{a.ownerEmail}</p>}
                <div className="flex items-center gap-2 flex-wrap">
                  <PlanPill plan={a.plan} />
                  <StatusPill plan={a.plan} hasTrial={!!a.trialStartedAt} />
                  <span className="text-xs text-slate-400">{a.activeMembers}/{a.seats} seats</span>
                  <span className="text-xs font-mono text-amber-400 ml-auto">{a.creditBalance.toLocaleString()} cr</span>
                </div>
              </div>
            ))}
          </div>

          {/* Pager — bounds table length as the account count grows. */}
          {paged.pageCount > 1 && (
            <div className="flex items-center justify-between pt-1">
              <p className="text-xs text-slate-500">
                Showing {paged.start + 1}–{paged.start + paged.rows.length} of {paged.total}
              </p>
              <div className="flex items-center gap-2">
                <Button aria-label="Previous page" variant="outline" size="sm" className="border-white/10 bg-white/[0.03] text-slate-300 hover:bg-white/5" disabled={paged.page <= 1} onClick={() => setPage((p) => p - 1)}>
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <span className="text-xs text-slate-400 tabular-nums">{paged.page} / {paged.pageCount}</span>
                <Button aria-label="Next page" variant="outline" size="sm" className="border-white/10 bg-white/[0.03] text-slate-300 hover:bg-white/5" disabled={paged.page >= paged.pageCount} onClick={() => setPage((p) => p + 1)}>
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
