/**
 * CreditLedger — Combined layout:
 * - Summary stat cards (Balance, Spent, Earned) with inline sparkline
 * - Compact grouped-by-date transaction list with colored left-edge bars
 * - Server-side type filtering and pagination
 */
import { useState, useMemo, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { useTenant } from "@/contexts/TenantContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Loader2,
  ChevronLeft,
  ChevronRight,
  TrendingDown,
  TrendingUp,
  Wallet,
  RotateCcw,
  Minus,
  Plus,
  Activity,
  Download,
  CalendarDays,
} from "lucide-react";

const PAGE_SIZE = 30;

type ReasonFilter = "all" | "generation" | "refund" | "topup" | "subscription_start" | "subscription_renewal" | "grant" | "adjustment";

const REASON_LABELS: Record<string, string> = {
  generation: "Generation",
  refund: "Refund",
  topup: "Top-up",
  subscription_start: "Subscription",
  subscription_renewal: "Renewal",
  grant: "Grant",
  adjustment: "Adjustment",
};

function getReasonBarColor(reason: string): string {
  switch (reason) {
    case "generation": return "bg-orange-500";
    case "refund": return "bg-amber-500";
    case "topup": return "bg-blue-500";
    case "subscription_start":
    case "subscription_renewal": return "bg-purple-500";
    case "grant": return "bg-green-500";
    default: return "bg-slate-500";
  }
}

/** Inline SVG sparkline for the balance trend card. */
function BalanceSparkline({ entries }: { entries: Array<{ balanceAfter: number }> }) {
  const points = useMemo(() => {
    if (entries.length < 2) return null;
    // Reverse so oldest is first (entries come newest-first from API)
    const sorted = [...entries].reverse();
    const balances = sorted.map((e) => e.balanceAfter);
    const min = Math.min(...balances);
    const max = Math.max(...balances);
    const range = max - min || 1;
    const width = 120;
    const height = 36;
    const padding = 2;

    const coords = balances.map((b, i) => {
      const x = padding + (i / (balances.length - 1)) * (width - padding * 2);
      const y = height - padding - ((b - min) / range) * (height - padding * 2);
      return `${x},${y}`;
    });

    return { path: coords.join(" "), width, height };
  }, [entries]);

  if (!points) {
    return <div className="w-[120px] h-[36px]" />;
  }

  return (
    <svg viewBox={`0 0 ${points.width} ${points.height}`} className="w-[120px] h-[36px]" preserveAspectRatio="none">
      <defs>
        <linearGradient id="sparkFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="oklch(0.75 0.18 145)" stopOpacity="0.25" />
          <stop offset="100%" stopColor="oklch(0.75 0.18 145)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon
        points={`${points.path.split(" ")[0].split(",")[0]},${points.height} ${points.path} ${points.path.split(" ").pop()?.split(",")[0]},${points.height}`}
        fill="url(#sparkFill)"
      />
      <polyline
        points={points.path}
        fill="none"
        stroke="oklch(0.75 0.18 145)"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

type DateRange = "all" | "today" | "7d" | "30d" | "90d";

function getDateRangeMs(range: DateRange): { from?: number; to?: number } {
  if (range === "all") return {};
  const now = Date.now();
  const dayMs = 86_400_000;
  switch (range) {
    case "today": return { from: now - dayMs, to: now };
    case "7d": return { from: now - 7 * dayMs, to: now };
    case "30d": return { from: now - 30 * dayMs, to: now };
    case "90d": return { from: now - 90 * dayMs, to: now };
  }
}

export default function CreditLedger() {
  const { tenant } = useTenant();
  const [page, setPage] = useState(0);
  const [filter, setFilter] = useState<ReasonFilter>("all");
  const [dateRange, setDateRange] = useState<DateRange>("all");

  const rangeMs = useMemo(() => getDateRangeMs(dateRange), [dateRange]);

  const { data, isLoading } = trpc.studio.creditLedger.useQuery(
    {
      tenantId: tenant?.id ?? 0,
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
      reason: filter === "all" ? undefined : filter,
      from: rangeMs.from,
      to: rangeMs.to,
    },
    { enabled: !!tenant }
  );

  const entries = data?.entries ?? [];
  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 0;

  // Compute summary stats from visible entries
  const stats = useMemo(() => {
    const spent = entries.filter((e) => e.delta < 0).reduce((sum, e) => sum + Math.abs(e.delta), 0);
    const earned = entries.filter((e) => e.delta > 0).reduce((sum, e) => sum + e.delta, 0);
    return { spent, earned };
  }, [entries]);

  // Group entries by date
  const grouped = useMemo(() => {
    const groups: Record<string, typeof entries> = {};
    for (const entry of entries) {
      const dateKey = new Date(entry.createdAt).toLocaleDateString(undefined, {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
      });
      if (!groups[dateKey]) groups[dateKey] = [];
      groups[dateKey].push(entry);
    }
    return groups;
  }, [entries]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Credit Ledger</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Account statement for your workspace.
        </p>
      </div>

      {/* Summary stat cards with sparkline */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <Card className="bg-gradient-to-br from-primary/5 to-primary/10 border-primary/20">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <Wallet className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">Balance</p>
              <p className="text-xl font-bold tabular-nums">{tenant?.creditBalance.toLocaleString() ?? "—"}</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-red-500/10">
              <TrendingDown className="h-5 w-5 text-red-400" />
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">Spent</p>
              <p className="text-xl font-bold tabular-nums text-red-400">-{stats.spent}</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-green-500/10">
              <TrendingUp className="h-5 w-5 text-green-500" />
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">Earned</p>
              <p className="text-xl font-bold tabular-nums text-green-500">+{stats.earned}</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium flex items-center gap-1">
                <Activity className="w-3 h-3" /> Trend
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {entries.length > 0
                  ? `${entries[entries.length - 1].balanceAfter.toLocaleString()} → ${entries[0].balanceAfter.toLocaleString()}`
                  : "No data"}
              </p>
            </div>
            <BalanceSparkline entries={entries} />
          </CardContent>
        </Card>
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <Select value={filter} onValueChange={(v) => { setFilter(v as ReasonFilter); setPage(0); }}>
          <SelectTrigger className="w-[180px]" size="sm">
            <SelectValue placeholder="Filter by type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="generation">Generation</SelectItem>
            <SelectItem value="refund">Refund</SelectItem>
            <SelectItem value="topup">Top-up</SelectItem>
            <SelectItem value="subscription_start">Subscription Start</SelectItem>
            <SelectItem value="subscription_renewal">Renewal</SelectItem>
            <SelectItem value="grant">Grant</SelectItem>
            <SelectItem value="adjustment">Adjustment</SelectItem>
          </SelectContent>
        </Select>
        <Select value={dateRange} onValueChange={(v) => { setDateRange(v as DateRange); setPage(0); }}>
          <SelectTrigger className="w-[140px]" size="sm">
            <CalendarDays className="w-3.5 h-3.5 mr-1.5 text-muted-foreground" />
            <SelectValue placeholder="Date range" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Time</SelectItem>
            <SelectItem value="today">Last 24h</SelectItem>
            <SelectItem value="7d">Last 7 days</SelectItem>
            <SelectItem value="30d">Last 30 days</SelectItem>
            <SelectItem value="90d">Last 90 days</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground">
          {data?.total ?? 0} total entries
        </span>
        <div className="ml-auto">
          <Button
            variant="outline"
            size="sm"
            disabled={entries.length === 0}
            onClick={() => {
              const rows = entries.map((e) => ({
                Date: new Date(e.createdAt).toISOString(),
                Type: REASON_LABELS[e.reason] || e.reason,
                Reference: e.refId || e.note || "",
                Amount: e.delta,
                Balance: e.balanceAfter,
              }));
              const header = Object.keys(rows[0] || {}).join(",");
              const csv = [header, ...rows.map((r) => Object.values(r).map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))].join("\n");
              const blob = new Blob([csv], { type: "text/csv" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = `credit-ledger-${new Date().toISOString().slice(0, 10)}.csv`;
              a.click();
              URL.revokeObjectURL(url);
            }}
          >
            <Download className="w-4 h-4 mr-1" />
            Export CSV
          </Button>
        </div>
      </div>

      {/* Grouped transaction list */}
      {entries.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <RotateCcw className="h-10 w-10 text-muted-foreground/40 mb-3" />
            <p className="text-sm text-muted-foreground">No credit activity found.</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            {Object.entries(grouped).map(([dateLabel, dayEntries], groupIdx) => (
              <div key={dateLabel}>
                {/* Date header */}
                <div className={`sticky top-0 z-10 bg-card/95 backdrop-blur-sm px-4 py-2.5 ${
                  groupIdx > 0 ? "border-t border-border" : ""
                }`}>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{dateLabel}</p>
                </div>

                {/* Compact rows with colored left bar */}
                <div className="divide-y divide-border/40">
                  {dayEntries.map((entry) => {
                    const isPositive = entry.delta > 0;
                    return (
                      <div key={entry.id} className="flex items-center gap-0 hover:bg-accent/20 transition-colors">
                        {/* Colored left edge bar */}
                        <div className={`w-1 self-stretch shrink-0 ${getReasonBarColor(entry.reason)}`} />

                        <div className="flex items-center justify-between flex-1 px-4 py-3">
                          <div className="flex items-center gap-3 min-w-0">
                            {/* +/- circle */}
                            <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${
                              isPositive ? "bg-green-500/10" : "bg-red-500/10"
                            }`}>
                              {isPositive ? (
                                <Plus className="w-3.5 h-3.5 text-green-500" />
                              ) : (
                                <Minus className="w-3.5 h-3.5 text-red-400" />
                              )}
                            </div>

                            <div className="min-w-0">
                              <p className="text-sm font-medium truncate">
                                {REASON_LABELS[entry.reason] ?? entry.reason}
                              </p>
                              <p className="text-[11px] text-muted-foreground truncate">
                                {entry.refId || entry.note || "—"} &middot;{" "}
                                {new Date(entry.createdAt).toLocaleTimeString(undefined, {
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })}
                              </p>
                            </div>
                          </div>

                          <div className="text-right shrink-0 ml-4">
                            <p className={`text-sm font-bold tabular-nums ${
                              isPositive ? "text-green-500" : "text-red-400"
                            }`}>
                              {isPositive ? "+" : ""}{entry.delta}
                            </p>
                            <p className="text-[10px] text-muted-foreground tabular-nums">
                              {entry.balanceAfter.toLocaleString()}
                            </p>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-2">
          <p className="text-xs text-muted-foreground">
            Page {page + 1} of {totalPages}
          </p>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
              <ChevronLeft className="w-4 h-4 mr-1" /> Previous
            </Button>
            <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage((p) => p + 1)}>
              Next <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
