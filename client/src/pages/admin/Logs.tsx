/**
 * Admin Server Logs page — queryable production logs for debugging.
 * Shows log entries with filtering by level, source, time range, tenant, job, and search.
 */
import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertCircle,
  AlertTriangle,
  Info,
  Bug,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  Search,
  Activity,
} from "lucide-react";

const LEVEL_CONFIG = {
  debug: { icon: Bug, color: "text-slate-400", bg: "bg-slate-500/10", badge: "outline" as const },
  info: { icon: Info, color: "text-blue-400", bg: "bg-blue-500/10", badge: "secondary" as const },
  warn: { icon: AlertTriangle, color: "text-amber-400", bg: "bg-amber-500/10", badge: "default" as const },
  error: { icon: AlertCircle, color: "text-red-400", bg: "bg-red-500/10", badge: "destructive" as const },
};

const PAGE_SIZE = 50;

export default function AdminLogs() {
  const [offset, setOffset] = useState(0);
  const [level, setLevel] = useState<string>("all");
  const [source, setSource] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [hours, setHours] = useState(24);
  const [tenantId, setTenantId] = useState<string>("");
  const [tenantIdInput, setTenantIdInput] = useState("");
  const [jobId, setJobId] = useState<string>("");
  const [jobIdInput, setJobIdInput] = useState("");

  const filters = useMemo(() => ({
    limit: PAGE_SIZE,
    offset,
    level: level !== "all" ? level as "debug" | "info" | "warn" | "error" : undefined,
    source: source !== "all" ? source : undefined,
    search: search || undefined,
    from: Date.now() - hours * 60 * 60 * 1000,
    tenantId: tenantId ? Number(tenantId) : undefined,
    jobId: jobId ? Number(jobId) : undefined,
  }), [offset, level, source, search, hours, tenantId, jobId]);

  const { data, isLoading, refetch } = trpc.adminLogs.list.useQuery(filters, {
    refetchInterval: 10000, // Auto-refresh every 10s
  });

  const { data: sources } = trpc.adminLogs.sources.useQuery();
  const { data: stats } = trpc.adminLogs.stats.useQuery({ hours });

  const handleSearch = () => {
    setSearch(searchInput);
    setOffset(0);
  };

  const handleTenantFilter = () => {
    setTenantId(tenantIdInput);
    setOffset(0);
  };

  const handleJobFilter = () => {
    setJobId(jobIdInput);
    setOffset(0);
  };

  const totalPages = Math.ceil((data?.total ?? 0) / PAGE_SIZE);
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

  return (
    <div className="max-w-6xl mx-auto space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Activity className="w-6 h-6" />
            Server Logs
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Production debugging — real-time generation pipeline events and errors.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RefreshCw className="w-4 h-4 mr-1" />
          Refresh
        </Button>
      </div>

      {/* Stats cards */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-4 pb-3">
              <div className="text-2xl font-bold">{stats.total}</div>
              <div className="text-xs text-muted-foreground">Total (last {hours}h)</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3">
              <div className="text-2xl font-bold text-red-400">{stats.errors}</div>
              <div className="text-xs text-muted-foreground">Errors</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3">
              <div className="text-2xl font-bold text-amber-400">{stats.warnings}</div>
              <div className="text-xs text-muted-foreground">Warnings</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3">
              <div className="text-2xl font-bold text-blue-400">{stats.bySource?.length ?? 0}</div>
              <div className="text-xs text-muted-foreground">Active sources</div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Filters */}
      <Card>
        <CardContent className="pt-4 pb-4">
          <div className="flex flex-wrap gap-3 items-end">
            {/* Search */}
            <div className="flex-1 min-w-[200px]">
              <label className="text-xs text-muted-foreground mb-1 block">Search</label>
              <div className="flex gap-2">
                <Input
                  placeholder="Search messages..."
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                  className="h-9"
                />
                <Button size="sm" variant="secondary" onClick={handleSearch}>
                  <Search className="w-4 h-4" />
                </Button>
              </div>
            </div>
            {/* Level */}
            <div className="w-[130px]">
              <label className="text-xs text-muted-foreground mb-1 block">Level</label>
              <Select value={level} onValueChange={(v) => { setLevel(v); setOffset(0); }}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All levels</SelectItem>
                  <SelectItem value="error">Error</SelectItem>
                  <SelectItem value="warn">Warning</SelectItem>
                  <SelectItem value="info">Info</SelectItem>
                  <SelectItem value="debug">Debug</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {/* Source */}
            <div className="w-[150px]">
              <label className="text-xs text-muted-foreground mb-1 block">Source</label>
              <Select value={source} onValueChange={(v) => { setSource(v); setOffset(0); }}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All sources</SelectItem>
                  {sources?.map((s) => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {/* Time range */}
            <div className="w-[130px]">
              <label className="text-xs text-muted-foreground mb-1 block">Time range</label>
              <Select value={String(hours)} onValueChange={(v) => { setHours(Number(v)); setOffset(0); }}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">Last 1h</SelectItem>
                  <SelectItem value="6">Last 6h</SelectItem>
                  <SelectItem value="24">Last 24h</SelectItem>
                  <SelectItem value="72">Last 3d</SelectItem>
                  <SelectItem value="168">Last 7d</SelectItem>
                  <SelectItem value="720">Last 30d</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Second row: Tenant ID and Job ID */}
          <div className="flex flex-wrap gap-3 items-end mt-3 pt-3 border-t border-border/50">
            <div className="w-[160px]">
              <label className="text-xs text-muted-foreground mb-1 block">Tenant ID</label>
              <div className="flex gap-1">
                <Input
                  type="number"
                  placeholder="e.g. 7"
                  value={tenantIdInput}
                  onChange={(e) => setTenantIdInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleTenantFilter()}
                  className="h-9"
                  min={1}
                />
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={handleTenantFilter}
                  className="h-9 px-2"
                >
                  <Search className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
            <div className="w-[160px]">
              <label className="text-xs text-muted-foreground mb-1 block">Job ID</label>
              <div className="flex gap-1">
                <Input
                  type="number"
                  placeholder="e.g. 42"
                  value={jobIdInput}
                  onChange={(e) => setJobIdInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleJobFilter()}
                  className="h-9"
                  min={1}
                />
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={handleJobFilter}
                  className="h-9 px-2"
                >
                  <Search className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
            {/* Active filter badges */}
            {(tenantId || jobId) && (
              <div className="flex items-center gap-2 ml-2">
                {tenantId && (
                  <Badge
                    variant="secondary"
                    className="cursor-pointer hover:bg-destructive/20 transition-colors"
                    onClick={() => { setTenantId(""); setTenantIdInput(""); setOffset(0); }}
                  >
                    tenant:{tenantId} ×
                  </Badge>
                )}
                {jobId && (
                  <Badge
                    variant="secondary"
                    className="cursor-pointer hover:bg-destructive/20 transition-colors"
                    onClick={() => { setJobId(""); setJobIdInput(""); setOffset(0); }}
                  >
                    job:{jobId} ×
                  </Badge>
                )}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Log entries */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center justify-between">
            <span>{data?.total ?? 0} entries</span>
            <span className="text-xs text-muted-foreground">
              Page {currentPage} of {totalPages || 1}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground">Loading...</div>
          ) : !data?.logs?.length ? (
            <div className="p-8 text-center text-muted-foreground">No logs found for the selected filters.</div>
          ) : (
            <div className="divide-y divide-border">
              {data.logs.map((entry) => {
                const config = LEVEL_CONFIG[entry.level as keyof typeof LEVEL_CONFIG] ?? LEVEL_CONFIG.info;
                const Icon = config.icon;
                const time = new Date(entry.createdAt).toLocaleString();
                return (
                  <div key={entry.id} className="px-4 py-3 hover:bg-muted/30 transition-colors">
                    <div className="flex items-start gap-3">
                      <div className={`mt-0.5 p-1 rounded ${config.bg}`}>
                        <Icon className={`w-3.5 h-3.5 ${config.color}`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge variant={config.badge} className="text-[10px] px-1.5 py-0">
                            {entry.level}
                          </Badge>
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                            {entry.source}
                          </Badge>
                          {entry.jobId && (
                            <span
                              className="text-[10px] text-muted-foreground cursor-pointer hover:text-foreground transition-colors"
                              onClick={() => { setJobIdInput(String(entry.jobId)); setJobId(String(entry.jobId)); setOffset(0); }}
                              title="Click to filter by this job"
                            >
                              job:{entry.jobId}
                            </span>
                          )}
                          {entry.tenantId && (
                            <span
                              className="text-[10px] text-muted-foreground cursor-pointer hover:text-foreground transition-colors"
                              onClick={() => { setTenantIdInput(String(entry.tenantId)); setTenantId(String(entry.tenantId)); setOffset(0); }}
                              title="Click to filter by this tenant"
                            >
                              tenant:{entry.tenantId}
                            </span>
                          )}
                          {entry.durationMs && (
                            <span className="text-[10px] text-muted-foreground">
                              {entry.durationMs}ms
                            </span>
                          )}
                        </div>
                        <p className="text-sm mt-1 break-words">{entry.message}</p>
                        {entry.metadata ? (
                          <pre className="text-[11px] text-muted-foreground mt-1 bg-muted/50 rounded px-2 py-1 overflow-x-auto max-h-24">
                            {String(JSON.stringify(entry.metadata, null, 2))}
                          </pre>
                        ) : null}
                      </div>
                      <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                        {time}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Pagination */}
          {(data?.total ?? 0) > PAGE_SIZE && (
            <div className="flex items-center justify-center gap-2 py-3 border-t">
              <Button
                variant="ghost"
                size="sm"
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              >
                <ChevronLeft className="w-4 h-4" />
                Prev
              </Button>
              <span className="text-xs text-muted-foreground">
                {currentPage} / {totalPages}
              </span>
              <Button
                variant="ghost"
                size="sm"
                disabled={offset + PAGE_SIZE >= (data?.total ?? 0)}
                onClick={() => setOffset(offset + PAGE_SIZE)}
              >
                Next
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
