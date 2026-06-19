/**
 * CreditLedger — full credit history view for the tenant.
 * Shows all deductions, refunds, grants, and top-ups with pagination and filtering.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useTenant } from "@/contexts/TenantContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Loader2,
  ChevronLeft,
  ChevronRight,
  ArrowDownCircle,
  ArrowUpCircle,
  RotateCcw,
  Coins,
} from "lucide-react";

const PAGE_SIZE = 25;

type ReasonFilter = "all" | "generation" | "refund" | "topup" | "subscription_start" | "subscription_renewal" | "grant" | "adjustment";

const REASON_LABELS: Record<string, string> = {
  generation: "Generation",
  refund: "Refund",
  topup: "Top-up",
  subscription_start: "Subscription Start",
  subscription_renewal: "Renewal",
  grant: "Grant",
  adjustment: "Adjustment",
};

function getReasonBadge(reason: string) {
  switch (reason) {
    case "generation":
      return <Badge variant="secondary" className="text-xs">{REASON_LABELS[reason]}</Badge>;
    case "refund":
      return <Badge variant="outline" className="text-xs border-amber-500/40 text-amber-600">{REASON_LABELS[reason]}</Badge>;
    case "topup":
      return <Badge className="text-xs bg-blue-600/15 text-blue-600 border-blue-500/30">{REASON_LABELS[reason]}</Badge>;
    case "subscription_start":
    case "subscription_renewal":
      return <Badge className="text-xs bg-purple-600/15 text-purple-600 border-purple-500/30">{REASON_LABELS[reason] ?? reason}</Badge>;
    case "grant":
      return <Badge className="text-xs bg-green-600/15 text-green-600 border-green-500/30">{REASON_LABELS[reason]}</Badge>;
    case "adjustment":
      return <Badge variant="outline" className="text-xs">{REASON_LABELS[reason]}</Badge>;
    default:
      return <Badge variant="outline" className="text-xs capitalize">{reason}</Badge>;
  }
}

export default function CreditLedger() {
  const { tenant } = useTenant();
  const [page, setPage] = useState(0);
  const [filter, setFilter] = useState<ReasonFilter>("all");

  const { data, isLoading } = trpc.studio.creditLedger.useQuery(
    {
      tenantId: tenant?.id ?? 0,
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
      reason: filter === "all" ? undefined : filter,
    },
    { enabled: !!tenant }
  );

  const filteredEntries = data?.entries ?? [];

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 0;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Credit Ledger</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Complete history of credit transactions for your workspace.
          </p>
        </div>
        {tenant && (
          <Card className="sm:min-w-[180px]">
            <CardContent className="p-4 flex items-center gap-3">
              <Coins className="h-5 w-5 text-primary" />
              <div>
                <p className="text-xs text-muted-foreground">Current Balance</p>
                <p className="text-lg font-bold tabular-nums">{tenant.creditBalance.toLocaleString()}</p>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-3">
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
        <span className="text-xs text-muted-foreground">
          {data?.total ?? 0} total entries
        </span>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {filteredEntries.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <RotateCcw className="h-10 w-10 text-muted-foreground/40 mb-3" />
              <p className="text-sm text-muted-foreground">No credit activity found.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[140px]">Date</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Reference</TableHead>
                    <TableHead className="text-right w-[100px]">Amount</TableHead>
                    <TableHead className="text-right w-[100px]">Balance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredEntries.map((entry) => (
                    <TableRow key={entry.id}>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                        {new Date(entry.createdAt).toLocaleDateString(undefined, {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })}
                        <br />
                        <span className="text-[10px]">
                          {new Date(entry.createdAt).toLocaleTimeString(undefined, {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </TableCell>
                      <TableCell>{getReasonBadge(entry.reason)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate">
                        {entry.refId || entry.note || "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        <span
                          className={`inline-flex items-center gap-1 font-semibold tabular-nums text-sm ${
                            entry.delta > 0 ? "text-green-600" : "text-destructive"
                          }`}
                        >
                          {entry.delta > 0 ? (
                            <ArrowUpCircle className="w-3.5 h-3.5" />
                          ) : (
                            <ArrowDownCircle className="w-3.5 h-3.5" />
                          )}
                          {entry.delta > 0 ? "+" : ""}
                          {entry.delta}
                        </span>
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums text-sm">
                        {entry.balanceAfter.toLocaleString()}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            Page {page + 1} of {totalPages}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page === 0}
              onClick={() => setPage((p) => p - 1)}
            >
              <ChevronLeft className="w-4 h-4 mr-1" />
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages - 1}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
              <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
