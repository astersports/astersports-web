/**
 * StudioHistoryV2 — Hybrid History: Recent Strip + Paginated Archive Table
 * MOCKUP for user review. Uses same data source as StudioHistory.
 *
 * Layout:
 * 1. "Recent" horizontal strip (last 12 generations, scrollable)
 * 2. Archive table with search, filters, pagination, and "Created by" column
 */
import { useState, useRef, useEffect, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { useTenant } from "@/contexts/TenantContext";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  Loader2,
  Image as ImageIcon,
  Download,
  Search,
  ChevronLeft,
  ChevronRight,
  ArrowLeftRight,
  Eye,
  Star,
  RotateCcw,
  Clock,
  Zap,
  Palette,
  Maximize2,
  Filter,
  User,
} from "lucide-react";

const RECENT_COUNT = 12;
const ARCHIVE_PAGE_SIZE = 20;

/** Parse controls JSON into a human-readable change description. */
function describeControls(controls: any): string {
  if (!controls) return "";
  const parts: string[] = [];
  if (controls.scale?.enabled) {
    parts.push(`Scale ${controls.scale.percent > 0 ? "+" : ""}${controls.scale.percent}%`);
  }
  if (controls.density?.enabled) {
    parts.push(`Density -${controls.density.percent}%`);
  }
  if (controls.remove?.enabled) {
    parts.push(`Remove "${controls.remove.element}"`);
  }
  if (controls.recolor?.enabled) {
    parts.push(`Recolor → ${controls.recolor.targetColor}`);
  }
  return parts.join(" · ") || "—";
}

/** Derive a generation type tag from controls. */
function getGenerationType(controls: any): { label: string; color: string } {
  if (!controls) return { label: "Upload", color: "bg-slate-500/20 text-slate-300" };
  if (controls.recolor?.enabled) return { label: "Recolor", color: "bg-violet-500/20 text-violet-300" };
  if (controls.scale?.enabled) return { label: "Scale", color: "bg-blue-500/20 text-blue-300" };
  if (controls.density?.enabled) return { label: "Density", color: "bg-emerald-500/20 text-emerald-300" };
  if (controls.remove?.enabled) return { label: "Remove", color: "bg-rose-500/20 text-rose-300" };
  return { label: "Edit", color: "bg-amber-500/20 text-amber-300" };
}

/** Trigger a download for an image URL. */
function downloadImage(url: string, filename: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

function timeAgo(date: string | Date): string {
  const now = Date.now();
  const then = new Date(date).getTime();
  const diff = now - then;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(date).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function StudioHistoryV2() {
  const { tenant } = useTenant();

  // ─── Recent strip data (first 12, no filters) ──────────────────────────────
  const { data: recentData, isLoading: recentLoading } = trpc.studio.historyArchive.useQuery(
    {
      tenantId: tenant?.id ?? 0,
      limit: RECENT_COUNT,
      offset: 0,
      status: "done",
    },
    { enabled: !!tenant }
  );

  // ─── Archive table data (paginated, filtered) ──────────────────────────────
  const [archivePage, setArchivePage] = useState(0);
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedJob, setSelectedJob] = useState<any | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounce search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setSearchQuery(searchInput);
      setArchivePage(0);
    }, 400);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [searchInput]);

  const { data: archiveData, isLoading: archiveLoading } = trpc.studio.historyArchive.useQuery(
    {
      tenantId: tenant?.id ?? 0,
      limit: ARCHIVE_PAGE_SIZE,
      offset: archivePage * ARCHIVE_PAGE_SIZE,
      status: statusFilter === "all" ? undefined : statusFilter,
      search: searchQuery || undefined,
    },
    { enabled: !!tenant }
  );

  const { data: favoriteIds = [] } = trpc.studio.favoriteIds.useQuery(
    { tenantId: tenant?.id ?? 0 },
    { enabled: !!tenant }
  );

  const utils = trpc.useUtils();
  const toggleFavoriteMutation = trpc.studio.toggleFavorite.useMutation({
    onSuccess: () => {
      utils.studio.favoriteIds.invalidate();
      utils.studio.historyArchive.invalidate();
    },
  });

  const recentJobs = recentData?.jobs ?? [];
  const archiveJobs = archiveData?.jobs ?? [];
  const totalArchivePages = archiveData ? Math.ceil(archiveData.total / ARCHIVE_PAGE_SIZE) : 0;

  const isFavorite = (jobId: number) => favoriteIds.includes(jobId);

  const handleToggleFavorite = (e: React.MouseEvent, jobId: number) => {
    e.stopPropagation();
    if (!tenant) return;
    toggleFavoriteMutation.mutate({ tenantId: tenant.id, jobId });
  };

  // Horizontal scroll for recent strip
  const stripRef = useRef<HTMLDivElement>(null);
  const scrollStrip = (dir: "left" | "right") => {
    if (!stripRef.current) return;
    const amount = 300;
    stripRef.current.scrollBy({ left: dir === "left" ? -amount : amount, behavior: "smooth" });
  };

  if (recentLoading && !recentData) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto space-y-8 pb-12">
      {/* ═══ Section 1: Recent Strip ═══ */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-2xl font-bold">History</h1>
            <p className="text-muted-foreground text-sm mt-0.5">
              Your recent generations and full archive.
            </p>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => scrollStrip("left")}
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => scrollStrip("right")}
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* Horizontal scrollable strip */}
        <div
          ref={stripRef}
          className="flex gap-3 overflow-x-auto pb-3 scrollbar-thin scrollbar-thumb-muted scrollbar-track-transparent snap-x"
          style={{ scrollSnapType: "x mandatory" }}
        >
          {recentJobs.length === 0 && (
            <div className="flex items-center justify-center w-full py-10 text-muted-foreground text-sm">
              <ImageIcon className="w-5 h-5 mr-2 opacity-50" />
              No recent generations yet.
            </div>
          )}
          {recentJobs.map((job) => {
            const resultUrl = job.variations?.[0]?.resultUrl;
            const genType = getGenerationType(job.controls);
            const favorited = isFavorite(job.id);
            return (
              <div
                key={job.id}
                className="shrink-0 w-[180px] snap-start group cursor-pointer"
                onClick={() => setSelectedJob(job)}
              >
                <div className="relative aspect-[3/4] rounded-xl overflow-hidden bg-muted border border-border/50 group-hover:border-primary/40 transition-all duration-200 group-hover:shadow-lg group-hover:shadow-primary/5">
                  <img
                    src={resultUrl || job.originalUrl}
                    alt={job.title}
                    className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                  />
                  {/* Type badge */}
                  <div className={`absolute top-2 left-2 rounded-full px-2 py-0.5 text-[10px] font-semibold ${genType.color}`}>
                    {genType.label}
                  </div>
                  {/* Favorite star */}
                  {favorited && (
                    <Star className="absolute top-2 right-2 w-4 h-4 fill-amber-400 text-amber-400 drop-shadow" />
                  )}
                  {/* Time overlay */}
                  <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent p-2 pt-6">
                    <p className="text-[11px] text-white/90 font-medium truncate">{job.title}</p>
                    <p className="text-[10px] text-white/60">{timeAgo(job.createdAt)}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* ═══ Section 2: Archive Table ═══ */}
      <section>
        <div className="flex items-center gap-2 mb-4">
          <h2 className="text-lg font-semibold">Archive</h2>
          <Badge variant="outline" className="text-xs tabular-nums">
            {archiveData?.total ?? 0} total
          </Badge>
        </div>

        {/* Filters row */}
        <div className="flex flex-col sm:flex-row gap-3 mb-4">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search prompts, titles, elements..."
              className="pl-9 h-9"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
          </div>
          <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setArchivePage(0); }}>
            <SelectTrigger className="w-[130px] h-9">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="done">Completed</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
              <SelectItem value="processing">Processing</SelectItem>
            </SelectContent>
          </Select>
          <Select value={typeFilter} onValueChange={(v) => { setTypeFilter(v); setArchivePage(0); }}>
            <SelectTrigger className="w-[130px] h-9">
              <SelectValue placeholder="Type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              <SelectItem value="recolor">Recolor</SelectItem>
              <SelectItem value="scale">Scale</SelectItem>
              <SelectItem value="density">Density</SelectItem>
              <SelectItem value="remove">Remove</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Archive Table */}
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/50 bg-muted/30">
                  <th className="text-left font-medium text-muted-foreground px-4 py-3 w-16">Preview</th>
                  <th className="text-left font-medium text-muted-foreground px-4 py-3">Title</th>
                  <th className="text-left font-medium text-muted-foreground px-4 py-3 hidden md:table-cell">Type</th>
                  <th className="text-left font-medium text-muted-foreground px-4 py-3 hidden lg:table-cell">Changes</th>
                  <th className="text-left font-medium text-muted-foreground px-4 py-3 hidden sm:table-cell">Created by</th>
                  <th className="text-left font-medium text-muted-foreground px-4 py-3">Date</th>
                  <th className="text-left font-medium text-muted-foreground px-4 py-3 w-10">Status</th>
                  <th className="text-right font-medium text-muted-foreground px-4 py-3 w-24">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/30">
                {archiveLoading && archiveJobs.length === 0 && (
                  <tr>
                    <td colSpan={8} className="text-center py-12">
                      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground mx-auto" />
                    </td>
                  </tr>
                )}
                {!archiveLoading && archiveJobs.length === 0 && (
                  <tr>
                    <td colSpan={8} className="text-center py-12 text-muted-foreground">
                      <ImageIcon className="h-8 w-8 mx-auto mb-2 opacity-40" />
                      <p>No jobs match your filters.</p>
                    </td>
                  </tr>
                )}
                {archiveJobs.map((job) => {
                  const resultUrl = job.variations?.[0]?.resultUrl;
                  const genType = getGenerationType(job.controls);
                  const changeDesc = describeControls(job.controls);
                  const favorited = isFavorite(job.id);
                  return (
                    <tr
                      key={job.id}
                      className="hover:bg-accent/10 cursor-pointer transition-colors"
                      onClick={() => setSelectedJob(job)}
                    >
                      {/* Thumbnail */}
                      <td className="px-4 py-2.5">
                        <div className="w-10 h-10 rounded-md overflow-hidden bg-muted border border-border/50">
                          <img
                            src={resultUrl || job.originalUrl}
                            alt=""
                            className="w-full h-full object-cover"
                          />
                        </div>
                      </td>
                      {/* Title + favorite */}
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-1.5">
                          {favorited && <Star className="w-3 h-3 fill-amber-400 text-amber-400 shrink-0" />}
                          <span className="font-medium truncate max-w-[200px]">{job.title}</span>
                        </div>
                      </td>
                      {/* Type */}
                      <td className="px-4 py-2.5 hidden md:table-cell">
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${genType.color}`}>
                          {genType.label}
                        </span>
                      </td>
                      {/* Changes */}
                      <td className="px-4 py-2.5 hidden lg:table-cell">
                        <span className="text-xs text-muted-foreground truncate max-w-[180px] block">
                          {changeDesc}
                        </span>
                      </td>
                      {/* Created by */}
                      <td className="px-4 py-2.5 hidden sm:table-cell">
                        <div className="flex items-center gap-1.5">
                          <div className="w-5 h-5 rounded-full bg-primary/20 flex items-center justify-center">
                            <User className="w-3 h-3 text-primary" />
                          </div>
                          <span className="text-xs text-muted-foreground">
                            {(job as any).userName ?? "You"}
                          </span>
                        </div>
                      </td>
                      {/* Date */}
                      <td className="px-4 py-2.5">
                        <span className="text-xs text-muted-foreground whitespace-nowrap">
                          {timeAgo(job.createdAt)}
                        </span>
                      </td>
                      {/* Status */}
                      <td className="px-4 py-2.5">
                        <Badge
                          variant={
                            job.status === "done" ? "default" :
                            job.status === "failed" ? "destructive" : "secondary"
                          }
                          className="text-[10px] h-5"
                        >
                          {job.status}
                        </Badge>
                      </td>
                      {/* Actions */}
                      <td className="px-4 py-2.5 text-right">
                        <div className="flex items-center justify-end gap-0.5">
                          <button
                            className="p-1.5 rounded hover:bg-accent/40 transition-colors"
                            onClick={(e) => handleToggleFavorite(e, job.id)}
                            title={favorited ? "Unfavorite" : "Favorite"}
                          >
                            <Star className={`w-3.5 h-3.5 ${favorited ? "fill-amber-400 text-amber-400" : "text-muted-foreground"}`} />
                          </button>
                          {resultUrl && (
                            <button
                              className="p-1.5 rounded hover:bg-accent/40 transition-colors"
                              onClick={(e) => {
                                e.stopPropagation();
                                downloadImage(resultUrl, `${job.title}-result.png`);
                              }}
                              title="Download"
                            >
                              <Download className="w-3.5 h-3.5 text-muted-foreground" />
                            </button>
                          )}
                          <button
                            className="p-1.5 rounded hover:bg-accent/40 transition-colors"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedJob(job);
                            }}
                            title="View details"
                          >
                            <Eye className="w-3.5 h-3.5 text-muted-foreground" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>

        {/* Pagination */}
        {totalArchivePages > 1 && (
          <div className="flex items-center justify-between pt-4">
            <p className="text-xs text-muted-foreground">
              Showing {archivePage * ARCHIVE_PAGE_SIZE + 1}–{Math.min((archivePage + 1) * ARCHIVE_PAGE_SIZE, archiveData?.total ?? 0)} of {archiveData?.total ?? 0}
            </p>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs"
                disabled={archivePage === 0}
                onClick={() => setArchivePage((p) => p - 1)}
              >
                <ChevronLeft className="w-3.5 h-3.5 mr-1" />
                Prev
              </Button>
              <span className="text-xs text-muted-foreground px-2 tabular-nums">
                {archivePage + 1} / {totalArchivePages}
              </span>
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs"
                disabled={archivePage >= totalArchivePages - 1}
                onClick={() => setArchivePage((p) => p + 1)}
              >
                Next
                <ChevronRight className="w-3.5 h-3.5 ml-1" />
              </Button>
            </div>
          </div>
        )}
      </section>

      {/* ═══ Detail Dialog ═══ */}
      <Dialog open={!!selectedJob} onOpenChange={(open) => { if (!open) setSelectedJob(null); }}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          {selectedJob && (() => {
            const resultUrl = selectedJob.variations?.[0]?.resultUrl;
            const genType = getGenerationType(selectedJob.controls);
            const changeDesc = describeControls(selectedJob.controls);
            const favorited = isFavorite(selectedJob.id);
            return (
              <>
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    {selectedJob.title}
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${genType.color}`}>
                      {genType.label}
                    </span>
                  </DialogTitle>
                </DialogHeader>

                {/* Before/After comparison */}
                <div className="grid grid-cols-2 gap-3 mt-4">
                  <div className="space-y-1.5">
                    <p className="text-xs text-muted-foreground font-medium">Original</p>
                    <div className="aspect-[3/4] rounded-lg overflow-hidden bg-muted border border-border/50">
                      <img
                        src={selectedJob.originalUrl}
                        alt="Original"
                        className="w-full h-full object-cover"
                      />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <p className="text-xs text-muted-foreground font-medium">Result</p>
                    <div className="aspect-[3/4] rounded-lg overflow-hidden bg-muted border border-border/50">
                      {resultUrl ? (
                        <img
                          src={resultUrl}
                          alt="Result"
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                          <ImageIcon className="w-8 h-8 opacity-40" />
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Metadata */}
                <div className="grid grid-cols-2 gap-4 mt-4 text-sm">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Clock className="w-3.5 h-3.5" />
                    <span>{new Date(selectedJob.createdAt).toLocaleString()}</span>
                  </div>
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Zap className="w-3.5 h-3.5" />
                    <span>{selectedJob.creditsUsed ?? 0} credits</span>
                  </div>
                  <div className="flex items-center gap-2 text-muted-foreground col-span-2">
                    <Palette className="w-3.5 h-3.5" />
                    <span>{changeDesc}</span>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 mt-4 pt-4 border-t border-border/50">
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    onClick={(e) => handleToggleFavorite(e, selectedJob.id)}
                  >
                    <Star className={`w-3.5 h-3.5 ${favorited ? "fill-amber-400 text-amber-400" : ""}`} />
                    {favorited ? "Unfavorite" : "Favorite"}
                  </Button>
                  {resultUrl && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5"
                      onClick={() => downloadImage(resultUrl, `${selectedJob.title}-result.png`)}
                    >
                      <Download className="w-3.5 h-3.5" />
                      Download
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    onClick={() => {
                      toast.info("Re-run feature coming soon");
                    }}
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    Re-run
                  </Button>
                </div>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}
