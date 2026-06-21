/**
 * CreditLedger — Combined layout:
 * - Summary stat cards (Balance, Spent, Earned) with inline sparkline
 * - Toggle between chronological view and "Group by Member" view
 * - Compact grouped-by-date transaction list with colored left-edge bars
 * - Per-member grouping: spend bars with expandable transaction lists
 * - Server-side type filtering and pagination
 */
import { useState, useMemo, useCallback, useEffect, useRef } from "react";
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
import { Input } from "@/components/ui/input";
import {
  Loader2,
  ChevronDown,
  TrendingDown,
  TrendingUp,
  Wallet,
  RotateCcw,
  Minus,
  Plus,
  Activity,
  Download,
  CalendarDays,
  Search,
  FileText,
  Palette,
  Clock,
  Hash,
  Users,
  User,
  List,
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

type ViewMode = "chronological" | "by-member";

export default function CreditLedger() {
  const { tenant } = useTenant();
  const utils = trpc.useUtils();
  const [isExporting, setIsExporting] = useState(false);
  const [filter, setFilter] = useState<ReasonFilter>("all");
  const [dateRange, setDateRange] = useState<DateRange>("all");
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("chronological");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounce search input by 400ms
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setSearchQuery(searchInput.trim());
    }, 400);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [searchInput]);

  const rangeMs = useMemo(() => getDateRangeMs(dateRange), [dateRange]);

  // M5c: load-more via keyset cursor. The query key includes the filters, so
  // changing any filter/search starts a fresh first page automatically.
  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } =
    trpc.studio.creditLedger.useInfiniteQuery(
      {
        tenantId: tenant?.id ?? 0,
        limit: PAGE_SIZE,
        reason: filter === "all" ? undefined : filter,
        from: rangeMs.from,
        to: rangeMs.to,
        search: searchQuery || undefined,
      },
      {
        enabled: !!tenant && viewMode === "chronological",
        getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
      }
    );

  const entries = useMemo(() => data?.pages.flatMap((p) => p.entries) ?? [], [data]);
  const total = data?.pages[0]?.total ?? 0;

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

  // Export the FULL filtered set (not just the visible page) by paging through
  // the server with the active filters, then build one CSV.
  async function handleExportAll() {
    if (!tenant || isExporting) return;
    setIsExporting(true);
    try {
      const EXPORT_PAGE = 100;
      const MAX_ROWS = 50_000; // safety cap against a runaway export
      const all: any[] = [];
      let offset = 0;
      let total = Infinity;
      while (offset < total && all.length < MAX_ROWS) {
        const res = await utils.studio.creditLedger.fetch({
          tenantId: tenant.id,
          limit: EXPORT_PAGE,
          offset,
          reason: filter === "all" ? undefined : filter,
          from: rangeMs.from,
          to: rangeMs.to,
          search: searchQuery || undefined,
        });
        total = res.total;
        all.push(...res.entries);
        if (res.entries.length < EXPORT_PAGE) break;
        offset += EXPORT_PAGE;
      }
      if (all.length === 0) return;
      const rows = all.map((e) => ({
        Date: new Date(e.createdAt).toISOString(),
        Type: REASON_LABELS[e.reason] || e.reason,
        Reference: e.refId || e.note || "",
        Amount: e.delta,
        Balance: e.balanceAfter,
      }));
      // Neutralize CSV formula injection: a cell starting with = + - @ (or a
      // control char) is prefixed with a single quote so spreadsheets don't
      // execute it as a formula. refId/note are user-influenced.
      const csvCell = (v: unknown) => {
        let s = String(v);
        if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
        return `"${s.replace(/"/g, '""')}"`;
      };
      const header = Object.keys(rows[0]).join(",");
      const csv = [header, ...rows.map((r) => Object.values(r).map(csvCell).join(","))].join("\n");
      const blob = new Blob([csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `credit-ledger-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setIsExporting(false);
    }
  }

  if (isLoading && viewMode === "chronological") {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Credit Ledger</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Account statement for your workspace.
          </p>
        </div>
        {/* View mode toggle */}
        <div className="flex items-center gap-1 bg-muted/50 rounded-lg p-1">
          <button
            onClick={() => setViewMode("chronological")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all duration-200 ${
              viewMode === "chronological"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <List className="w-3.5 h-3.5" />
            Timeline
          </button>
          <button
            onClick={() => setViewMode("by-member")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all duration-200 ${
              viewMode === "by-member"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            By Member
          </button>
        </div>
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
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">Spent (loaded)</p>
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
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">Earned (loaded)</p>
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

      {/* Conditional view rendering */}
      {viewMode === "chronological" ? (
        <ChronologicalView
          entries={entries}
          grouped={grouped}
          hasNextPage={!!hasNextPage}
          isFetchingNextPage={isFetchingNextPage}
          onLoadMore={() => fetchNextPage()}
          filter={filter}
          setFilter={setFilter}
          dateRange={dateRange}
          setDateRange={setDateRange}
          searchInput={searchInput}
          setSearchInput={setSearchInput}
          expandedId={expandedId}
          setExpandedId={setExpandedId}
          total={total}
          onExport={handleExportAll}
          isExporting={isExporting}
        />
      ) : (
        <MemberGroupView tenantId={tenant?.id ?? 0} />
      )}
    </div>
  );
}

/* ─── Chronological View ───────────────────────────────────────────────────── */

function ChronologicalView({
  entries,
  grouped,
  hasNextPage,
  isFetchingNextPage,
  onLoadMore,
  filter,
  setFilter,
  dateRange,
  setDateRange,
  searchInput,
  setSearchInput,
  expandedId,
  setExpandedId,
  total,
  onExport,
  isExporting,
}: {
  entries: any[];
  grouped: Record<string, any[]>;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  onLoadMore: () => void;
  filter: ReasonFilter;
  setFilter: (f: ReasonFilter) => void;
  dateRange: DateRange;
  setDateRange: (d: DateRange) => void;
  searchInput: string;
  setSearchInput: (s: string) => void;
  expandedId: number | null;
  setExpandedId: (id: number | null) => void;
  total: number;
  onExport: () => void;
  isExporting: boolean;
}) {
  return (
    <>
      {/* Search + Filter bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative w-full sm:w-[220px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            placeholder="Search ref ID or note..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="pl-8 h-8 text-sm"
          />
        </div>
        <Select value={filter} onValueChange={(v) => setFilter(v as ReasonFilter)}>
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
        <Select value={dateRange} onValueChange={(v) => setDateRange(v as DateRange)}>
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
          {total} total entries
        </span>
        <div className="ml-auto">
          <Button
            variant="outline"
            size="sm"
            disabled={total === 0 || isExporting}
            onClick={onExport}
          >
            {isExporting ? (
              <Loader2 className="w-4 h-4 mr-1 animate-spin" />
            ) : (
              <Download className="w-4 h-4 mr-1" />
            )}
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
                  {dayEntries.map((entry) => (
                    <TransactionRow
                      key={entry.id}
                      entry={entry}
                      isExpanded={expandedId === entry.id}
                      onToggle={() => setExpandedId(expandedId === entry.id ? null : entry.id)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Load more (M5c keyset pagination) */}
      {hasNextPage && (
        <div className="flex justify-center pt-3">
          <Button
            variant="outline"
            size="sm"
            disabled={isFetchingNextPage}
            onClick={onLoadMore}
          >
            {isFetchingNextPage ? (
              <>
                <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                Loading...
              </>
            ) : (
              `Load more (${entries.length} of ${total})`
            )}
          </Button>
        </div>
      )}
    </>
  );
}

/* ─── Member Group View ────────────────────────────────────────────────────── */

function MemberGroupView({ tenantId }: { tenantId: number }) {
  const [expandedMember, setExpandedMember] = useState<number | null>(null);

  const { data: spendData, isLoading } = trpc.firmAdmin.spendByMember.useQuery(
    { tenantId },
    { enabled: !!tenantId }
  );

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-6 flex justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  const members = spendData?.members ?? [];
  const maxSpent = Math.max(...members.map((m) => m.spent7d), 1);
  const total7d = spendData?.totalSpent7d ?? 1;
  const totalAll = spendData?.totalSpentAll ?? 0;

  if (members.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16 text-center">
          <Users className="h-10 w-10 text-muted-foreground/40 mb-3" />
          <p className="text-sm text-muted-foreground">No member activity recorded yet.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {/* Summary bar */}
      <div className="flex items-center justify-between px-1">
        <p className="text-xs text-muted-foreground">
          {members.length} member{members.length !== 1 ? "s" : ""} with activity
        </p>
        <p className="text-xs text-muted-foreground">
          Total: <span className="font-medium text-foreground">{totalAll.toLocaleString()}</span> all-time
          {" · "}
          <span className="font-medium text-foreground">{total7d.toLocaleString()}</span> last 7d
        </p>
      </div>

      {members.map((member) => {
        const pct7d = total7d > 0 ? Math.round((member.spent7d / total7d) * 100) : 0;
        const barWidth = maxSpent > 0 ? (member.spent7d / maxSpent) * 100 : 0;
        const isExpanded = expandedMember === member.userId;

        return (
          <Card key={member.userId} className="overflow-hidden">
            {/* Member header with spend bar */}
            <div
              className={`cursor-pointer transition-colors ${
                isExpanded ? "bg-accent/20" : "hover:bg-accent/10"
              }`}
              onClick={() => setExpandedMember(isExpanded ? null : member.userId)}
            >
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-full bg-amber-500/10 flex items-center justify-center shrink-0">
                      <User className="w-4 h-4 text-amber-500" />
                    </div>
                    <div>
                      <p className="text-sm font-medium">{member.name}</p>
                      {member.email && (
                        <p className="text-[11px] text-muted-foreground">{member.email}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <p className="text-sm font-bold tabular-nums text-red-400">
                        -{member.spent7d.toLocaleString()}
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        {pct7d}% of 7d · {member.spentAll.toLocaleString()} total
                      </p>
                    </div>
                    <ChevronDown
                      className={`w-4 h-4 text-muted-foreground transition-transform duration-200 ${
                        isExpanded ? "rotate-180" : ""
                      }`}
                    />
                  </div>
                </div>
                {/* Spend bar */}
                <div className="h-2 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-amber-500 to-orange-500 transition-all duration-500"
                    style={{ width: `${barWidth}%` }}
                  />
                </div>
              </CardContent>
            </div>

            {/* Expanded: recent transactions for this member */}
            <div
              className={`overflow-hidden transition-all duration-300 ease-out ${
                isExpanded ? "max-h-[600px] opacity-100" : "max-h-0 opacity-0"
              }`}
            >
              <div className="border-t border-border">
                <MemberTransactions tenantId={tenantId} userId={member.userId} />
              </div>
            </div>
          </Card>
        );
      })}
    </div>
  );
}

/* ─── Member Transactions (loaded on expand) ───────────────────────────────── */

function MemberTransactions({ tenantId, userId }: { tenantId: number; userId: number }) {
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const { data, isLoading } = trpc.studio.creditLedger.useQuery(
    { tenantId, userId, limit: 10, offset: 0 },
    { enabled: !!tenantId && !!userId }
  );

  if (isLoading) {
    return (
      <div className="p-4 flex justify-center">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const entries = data?.entries ?? [];

  if (entries.length === 0) {
    return (
      <div className="p-4 text-center">
        <p className="text-xs text-muted-foreground">No transactions found.</p>
      </div>
    );
  }

  return (
    <div className="divide-y divide-border/40">
      <div className="px-4 py-2 bg-muted/30">
        <p className="text-[11px] text-muted-foreground font-medium">
          Recent transactions ({data?.total ?? 0} total)
        </p>
      </div>
      {entries.map((entry) => (
        <TransactionRow
          key={entry.id}
          entry={entry}
          isExpanded={expandedId === entry.id}
          onToggle={() => setExpandedId(expandedId === entry.id ? null : entry.id)}
          compact
        />
      ))}
    </div>
  );
}

/* ─── Shared Transaction Row ───────────────────────────────────────────────── */

function TransactionRow({
  entry,
  isExpanded,
  onToggle,
  compact = false,
}: {
  entry: any;
  isExpanded: boolean;
  onToggle: () => void;
  compact?: boolean;
}) {
  const isPositive = entry.delta > 0;
  const hasMetadata = entry.jobInstruction || entry.jobControls || entry.jobTitle;

  return (
    <div>
      <div
        className={`flex items-center gap-0 transition-colors cursor-pointer ${
          isExpanded ? "bg-accent/30" : "hover:bg-accent/20"
        }`}
        onClick={onToggle}
      >
        {/* Colored left edge bar */}
        <div className={`w-1 self-stretch shrink-0 ${getReasonBarColor(entry.reason)}`} />

        <div className={`flex items-center justify-between flex-1 ${compact ? "px-3 py-2" : "px-4 py-3"}`}>
          <div className="flex items-center gap-3 min-w-0">
            {/* +/- circle */}
            <div className={`${compact ? "w-6 h-6" : "w-7 h-7"} rounded-full flex items-center justify-center shrink-0 ${
              isPositive ? "bg-green-500/10" : "bg-red-500/10"
            }`}>
              {isPositive ? (
                <Plus className={`${compact ? "w-3 h-3" : "w-3.5 h-3.5"} text-green-500`} />
              ) : (
                <Minus className={`${compact ? "w-3 h-3" : "w-3.5 h-3.5"} text-red-400`} />
              )}
            </div>

            <div className="min-w-0">
              <p className={`${compact ? "text-xs" : "text-sm"} font-medium truncate`}>
                {REASON_LABELS[entry.reason] ?? entry.reason}
              </p>
              <p className="text-[11px] text-muted-foreground truncate">
                {entry.refId || entry.note || "\u2014"} &middot;{" "}
                {new Date(entry.createdAt).toLocaleTimeString(undefined, {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="text-right shrink-0">
              <p className={`${compact ? "text-xs" : "text-sm"} font-bold tabular-nums ${
                isPositive ? "text-green-500" : "text-red-400"
              }`}>
                {isPositive ? "+" : ""}{entry.delta}
              </p>
              <p className="text-[10px] text-muted-foreground tabular-nums">
                {entry.balanceAfter.toLocaleString()}
              </p>
            </div>
            <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform duration-200 ${
              isExpanded ? "rotate-180" : ""
            }`} />
          </div>
        </div>
      </div>

      {/* Expanded detail panel */}
      <div className={`overflow-hidden transition-all duration-250 ease-out ${
        isExpanded ? "max-h-[400px] opacity-100" : "max-h-0 opacity-0"
      }`}>
        <div className="px-5 py-4 ml-1 bg-accent/10 border-t border-border/30">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            {/* Full timestamp */}
            <div className="flex items-start gap-2">
              <Clock className="w-3.5 h-3.5 text-muted-foreground mt-0.5 shrink-0" />
              <div>
                <p className="text-muted-foreground font-medium">Timestamp</p>
                <p className="text-foreground">{new Date(entry.createdAt).toLocaleString()}</p>
              </div>
            </div>

            {/* Reference ID */}
            {entry.refId && (
              <div className="flex items-start gap-2">
                <Hash className="w-3.5 h-3.5 text-muted-foreground mt-0.5 shrink-0" />
                <div>
                  <p className="text-muted-foreground font-medium">Reference</p>
                  <p className="text-foreground font-mono">{entry.refId}</p>
                </div>
              </div>
            )}

            {/* Job title */}
            {entry.jobTitle && (
              <div className="flex items-start gap-2">
                <FileText className="w-3.5 h-3.5 text-muted-foreground mt-0.5 shrink-0" />
                <div>
                  <p className="text-muted-foreground font-medium">Job Title</p>
                  <p className="text-foreground">{entry.jobTitle}</p>
                </div>
              </div>
            )}

            {/* Job status */}
            {entry.jobStatus && (
              <div className="flex items-start gap-2">
                <Activity className="w-3.5 h-3.5 text-muted-foreground mt-0.5 shrink-0" />
                <div>
                  <p className="text-muted-foreground font-medium">Status</p>
                  <p className={`font-medium capitalize ${
                    entry.jobStatus === "done" ? "text-green-500" :
                    entry.jobStatus === "failed" ? "text-red-400" :
                    "text-yellow-500"
                  }`}>{entry.jobStatus}</p>
                </div>
              </div>
            )}

            {/* Controls used */}
            {entry.jobControls && (
              <div className="flex items-start gap-2 sm:col-span-2">
                <Palette className="w-3.5 h-3.5 text-muted-foreground mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <p className="text-muted-foreground font-medium">Controls Used</p>
                  <p className="text-foreground text-[11px] font-mono break-all whitespace-pre-wrap max-h-20 overflow-y-auto">
                    {(() => {
                      try {
                        const ctrl = JSON.parse(entry.jobControls!);
                        const active: string[] = [];
                        if (ctrl.scale?.enabled) active.push(`Scale: ${ctrl.scale.percent > 0 ? "+" : ""}${ctrl.scale.percent}%`);
                        if (ctrl.density?.enabled) active.push(`Density: -${ctrl.density.percent}%`);
                        if (ctrl.remove?.enabled) active.push(`Remove: ${ctrl.remove.percent}% of "${ctrl.remove.element}"`);
                        if (ctrl.recolor?.enabled) active.push(`Recolor: "${ctrl.recolor.element}" → ${ctrl.recolor.targetColor}`);
                        return active.length > 0 ? active.join(" · ") : "No active controls";
                      } catch { return entry.jobControls; }
                    })()}
                  </p>
                </div>
              </div>
            )}

            {/* AI Instruction */}
            {entry.jobInstruction && (
              <div className="flex items-start gap-2 sm:col-span-2">
                <FileText className="w-3.5 h-3.5 text-muted-foreground mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <p className="text-muted-foreground font-medium">AI Prompt</p>
                  <p className="text-foreground text-[11px] leading-relaxed max-h-32 overflow-y-auto whitespace-pre-wrap break-words">
                    {entry.jobInstruction}
                  </p>
                </div>
              </div>
            )}

            {/* Note (for non-job entries) */}
            {!hasMetadata && entry.note && (
              <div className="flex items-start gap-2 sm:col-span-2">
                <FileText className="w-3.5 h-3.5 text-muted-foreground mt-0.5 shrink-0" />
                <div>
                  <p className="text-muted-foreground font-medium">Note</p>
                  <p className="text-foreground">{entry.note}</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
