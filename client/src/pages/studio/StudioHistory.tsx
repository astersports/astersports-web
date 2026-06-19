/**
 * Studio History — Generation Archive
 * Full-featured archive of past jobs with before/after comparison,
 * change descriptions, re-download, search/filter, detail view, grid/list toggle,
 * favorites/pin system, re-run with same settings, and batch ZIP download.
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import {
  Loader2,
  Image as ImageIcon,
  Download,
  Search,
  Grid3X3,
  List,
  ChevronLeft,
  ChevronRight,
  ArrowLeftRight,
  Eye,
  Palette,
  FileText,
  Clock,
  Zap,
  Star,
  RotateCcw,
  CheckSquare,
  Square,
  PackageOpen,
  X,
} from "lucide-react";

const PAGE_SIZE = 24;

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
    parts.push(`Remove ${controls.remove.percent}% of "${controls.remove.element}"`);
  }
  if (controls.recolor?.enabled) {
    parts.push(`Recolor "${controls.recolor.element}" → ${controls.recolor.targetColor}`);
  }
  return parts.join(" · ") || "No active edits";
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

/** Download multiple images as a ZIP file using JSZip (loaded dynamically). */
async function downloadAsZip(
  items: Array<{ url: string; filename: string }>,
  zipName: string
) {
  // Dynamically import JSZip
  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();

  const results = await Promise.allSettled(
    items.map(async (item) => {
      const resp = await fetch(item.url);
      if (!resp.ok) throw new Error(`Failed to fetch ${item.url}`);
      const blob = await resp.blob();
      zip.file(item.filename, blob);
    })
  );

  const succeeded = results.filter((r) => r.status === "fulfilled").length;
  if (succeeded === 0) throw new Error("No files could be downloaded");

  const content = await zip.generateAsync({ type: "blob" });
  const url = URL.createObjectURL(content);
  const a = document.createElement("a");
  a.href = url;
  a.download = zipName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  return { succeeded, total: items.length };
}

export default function StudioHistory() {
  const { tenant } = useTenant();

  const [page, setPage] = useState(0);
  const [statusFilter, setStatusFilter] = useState("all");
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [selectedJob, setSelectedJob] = useState<any | null>(null);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [batchMode, setBatchMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [batchDownloading, setBatchDownloading] = useState(false);
  const [rerunConfirmJob, setRerunConfirmJob] = useState<any | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounce search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setSearchQuery(searchInput);
      setPage(0);
    }, 400);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [searchInput]);

  const { data, isLoading } = trpc.studio.historyArchive.useQuery(
    {
      tenantId: tenant?.id ?? 0,
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
      status: statusFilter === "all" ? undefined : statusFilter,
      search: searchQuery || undefined,
      favoritesOnly: favoritesOnly || undefined,
    },
    { enabled: !!tenant }
  );

  const { data: favoriteIds = [], refetch: refetchFavorites } = trpc.studio.favoriteIds.useQuery(
    { tenantId: tenant?.id ?? 0 },
    { enabled: !!tenant }
  );

  const utils = trpc.useUtils();

  const toggleFavoriteMutation = trpc.studio.toggleFavorite.useMutation({
    onSuccess: () => {
      refetchFavorites();
      // Also invalidate archive so favorites-only filter stays in sync
      utils.studio.historyArchive.invalidate();
    },
  });

  const rerunMutation = trpc.studio.rerun.useMutation({
    onSuccess: (result) => {
      toast.success("Re-run started", {
        description: `New job #${result.jobId} created (${result.creditsUsed} credits). Check the Editor for progress.`,
      });
      setRerunConfirmJob(null);
      setSelectedJob(null);
    },
    onError: (err) => {
      toast.error("Re-run failed", {
        description: err.message,
      });
      setRerunConfirmJob(null);
    },
  });

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 0;
  const jobs = data?.jobs ?? [];

  const toggleSelect = useCallback((jobId: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(jobId)) next.delete(jobId);
      else next.add(jobId);
      return next;
    });
  }, []);

  const handleBatchDownload = async () => {
    const items = jobs
      .filter((j) => selectedIds.has(j.id) && j.variations?.[0]?.resultUrl)
      .map((j) => ({
        url: j.variations[0].resultUrl,
        filename: `${j.title.replace(/[^a-zA-Z0-9_-]/g, "_")}-result.png`,
      }));

    if (items.length === 0) {
      toast.error("No downloadable results", { description: "Selected jobs have no result images." });
      return;
    }

    setBatchDownloading(true);
    try {
      const { succeeded, total } = await downloadAsZip(items, "generation-archive.zip");
      toast.success("Download complete", {
        description: `${succeeded}/${total} images packaged into ZIP.`,
      });
      setBatchMode(false);
      setSelectedIds(new Set());
    } catch (err: any) {
      toast.error("Download failed", { description: err.message });
    } finally {
      setBatchDownloading(false);
    }
  };

  const handleRerun = (job: any) => {
    setRerunConfirmJob(job);
  };

  const confirmRerun = () => {
    if (!rerunConfirmJob || !tenant) return;
    rerunMutation.mutate({ tenantId: tenant.id, jobId: rerunConfirmJob.id });
  };

  const isFavorite = (jobId: number) => favoriteIds.includes(jobId);

  const handleToggleFavorite = (e: React.MouseEvent, jobId: number) => {
    e.stopPropagation();
    if (!tenant) return;
    toggleFavoriteMutation.mutate({ tenantId: tenant.id, jobId });
  };

  if (isLoading && !data) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Generation Archive</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Browse, compare, and re-download all past edits.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Batch mode toggle */}
          <Button
            variant={batchMode ? "default" : "outline"}
            size="sm"
            className="h-8 text-xs"
            onClick={() => {
              setBatchMode(!batchMode);
              if (batchMode) setSelectedIds(new Set());
            }}
          >
            <CheckSquare className="w-3.5 h-3.5 mr-1" />
            {batchMode ? "Cancel" : "Select"}
          </Button>
          <Button
            variant={viewMode === "grid" ? "default" : "outline"}
            size="icon"
            className="h-8 w-8"
            onClick={() => setViewMode("grid")}
            title="Grid view"
          >
            <Grid3X3 className="w-4 h-4" />
          </Button>
          <Button
            variant={viewMode === "list" ? "default" : "outline"}
            size="icon"
            className="h-8 w-8"
            onClick={() => setViewMode("list")}
            title="List view"
          >
            <List className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Batch action bar */}
      {batchMode && selectedIds.size > 0 && (
        <div className="flex items-center gap-3 bg-primary/10 border border-primary/20 rounded-lg px-4 py-2.5">
          <PackageOpen className="w-4 h-4 text-primary" />
          <span className="text-sm font-medium">{selectedIds.size} selected</span>
          <Button
            size="sm"
            className="ml-auto h-7 text-xs"
            onClick={handleBatchDownload}
            disabled={batchDownloading}
          >
            {batchDownloading ? (
              <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
            ) : (
              <Download className="w-3.5 h-3.5 mr-1" />
            )}
            Download ZIP
          </Button>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search by title, element, or prompt..."
            className="pl-9 h-9"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
        </div>
        <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(0); }}>
          <SelectTrigger className="w-[140px] h-9">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="done">Completed</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
            <SelectItem value="processing">Processing</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
          </SelectContent>
        </Select>
        {/* Favorites filter */}
        <Button
          variant={favoritesOnly ? "default" : "outline"}
          size="sm"
          className="h-9 text-xs"
          onClick={() => { setFavoritesOnly(!favoritesOnly); setPage(0); }}
        >
          <Star className={`w-3.5 h-3.5 mr-1 ${favoritesOnly ? "fill-current" : ""}`} />
          Favorites
        </Button>
        <p className="text-xs text-muted-foreground self-center">
          {data?.total ?? 0} total jobs
        </p>
      </div>

      {/* Empty state */}
      {jobs.length === 0 && !isLoading && (
        <div className="text-center py-20">
          <ImageIcon className="mx-auto h-12 w-12 text-muted-foreground/50" />
          <h2 className="mt-4 text-lg font-semibold">No jobs found</h2>
          <p className="text-muted-foreground text-sm mt-1">
            {searchQuery || statusFilter !== "all" || favoritesOnly
              ? "Try adjusting your search or filters."
              : "Upload a garment image in the Editor to get started."}
          </p>
        </div>
      )}

      {/* Grid View */}
      {viewMode === "grid" && jobs.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {jobs.map((job) => {
            const resultUrl = job.variations?.[0]?.resultUrl;
            const changeDesc = describeControls(job.controls);
            const favorited = isFavorite(job.id);
            const selected = selectedIds.has(job.id);
            return (
              <Card
                key={job.id}
                className={`overflow-hidden transition-all group cursor-pointer ${
                  selected ? "ring-2 ring-primary" : "hover:ring-2 hover:ring-primary/20"
                }`}
                onClick={() => {
                  if (batchMode) {
                    toggleSelect(job.id);
                  } else {
                    setSelectedJob(job);
                  }
                }}
              >
                {/* Before/After thumbnail comparison */}
                <div className="aspect-[4/3] relative bg-muted overflow-hidden">
                  {resultUrl ? (
                    <div className="relative w-full h-full">
                      <img
                        src={resultUrl}
                        alt={`${job.title} result`}
                        className="w-full h-full object-cover"
                      />
                      <div className="absolute bottom-2 left-2 w-16 h-16 rounded-md overflow-hidden border-2 border-background shadow-lg opacity-80 group-hover:opacity-100 transition-opacity">
                        <img
                          src={job.originalUrl}
                          alt="Original"
                          className="w-full h-full object-cover"
                        />
                      </div>
                      <div className="absolute top-2 left-2 bg-black/60 backdrop-blur-sm rounded-full px-2 py-0.5 flex items-center gap-1">
                        <ArrowLeftRight className="w-3 h-3 text-white" />
                        <span className="text-[10px] text-white font-medium">Before/After</span>
                      </div>
                    </div>
                  ) : (
                    <img
                      src={job.originalUrl}
                      alt={job.title}
                      className="w-full h-full object-cover"
                    />
                  )}
                  {/* Status badge */}
                  <Badge
                    className="absolute top-2 right-2"
                    variant={
                      job.status === "done" ? "default" :
                      job.status === "failed" ? "destructive" : "secondary"
                    }
                  >
                    {job.status}
                  </Badge>
                  {/* Batch select checkbox */}
                  {batchMode && (
                    <div className="absolute top-2 left-2 z-10">
                      {selected ? (
                        <CheckSquare className="w-5 h-5 text-primary drop-shadow-md" />
                      ) : (
                        <Square className="w-5 h-5 text-white/70 drop-shadow-md" />
                      )}
                    </div>
                  )}
                  {/* Favorite star */}
                  {!batchMode && (
                    <button
                      className="absolute bottom-2 right-2 p-1.5 rounded-full bg-black/50 backdrop-blur-sm hover:bg-black/70 transition-colors"
                      onClick={(e) => handleToggleFavorite(e, job.id)}
                      title={favorited ? "Remove from favorites" : "Add to favorites"}
                    >
                      <Star className={`w-3.5 h-3.5 ${favorited ? "fill-amber-400 text-amber-400" : "text-white/70"}`} />
                    </button>
                  )}
                </div>

                <CardContent className="p-3 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium text-sm truncate">{job.title}</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        {new Date(job.createdAt).toLocaleDateString()} · {job.creditsUsed ?? 0} cr
                      </p>
                    </div>
                    {resultUrl && !batchMode && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 shrink-0"
                        onClick={(e) => {
                          e.stopPropagation();
                          downloadImage(resultUrl, `${job.title}-result.png`);
                        }}
                        title="Download result"
                      >
                        <Download className="w-3.5 h-3.5" />
                      </Button>
                    )}
                  </div>

                  {changeDesc && changeDesc !== "No active edits" && (
                    <p className="text-[11px] text-amber-400/80 truncate">
                      {changeDesc}
                    </p>
                  )}

                  {job.detectedElements.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {job.detectedElements.slice(0, 3).map((el: string) => (
                        <span
                          key={el}
                          className="rounded bg-secondary px-1.5 py-0.5 text-[10px] text-secondary-foreground"
                        >
                          {el}
                        </span>
                      ))}
                      {job.detectedElements.length > 3 && (
                        <span className="text-[10px] text-muted-foreground">
                          +{job.detectedElements.length - 3}
                        </span>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* List View */}
      {viewMode === "list" && jobs.length > 0 && (
        <Card>
          <CardContent className="p-0 divide-y divide-border/40">
            {jobs.map((job) => {
              const resultUrl = job.variations?.[0]?.resultUrl;
              const changeDesc = describeControls(job.controls);
              const favorited = isFavorite(job.id);
              const selected = selectedIds.has(job.id);
              return (
                <div
                  key={job.id}
                  className={`flex items-center gap-4 px-4 py-3 transition-colors cursor-pointer ${
                    selected ? "bg-primary/10" : "hover:bg-accent/20"
                  }`}
                  onClick={() => {
                    if (batchMode) {
                      toggleSelect(job.id);
                    } else {
                      setSelectedJob(job);
                    }
                  }}
                >
                  {/* Batch checkbox */}
                  {batchMode && (
                    <div className="shrink-0">
                      {selected ? (
                        <CheckSquare className="w-5 h-5 text-primary" />
                      ) : (
                        <Square className="w-5 h-5 text-muted-foreground" />
                      )}
                    </div>
                  )}

                  {/* Thumbnail */}
                  <div className="w-14 h-14 rounded-md overflow-hidden bg-muted shrink-0 relative">
                    <img
                      src={resultUrl || job.originalUrl}
                      alt={job.title}
                      className="w-full h-full object-cover"
                    />
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-sm truncate">{job.title}</p>
                      <Badge
                        variant={
                          job.status === "done" ? "default" :
                          job.status === "failed" ? "destructive" : "secondary"
                        }
                        className="text-[10px] h-5"
                      >
                        {job.status}
                      </Badge>
                      {favorited && <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />}
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      {new Date(job.createdAt).toLocaleDateString(undefined, {
                        month: "short", day: "numeric", year: "numeric",
                      })} · {job.creditsUsed ?? 0} credits
                    </p>
                    {changeDesc && changeDesc !== "No active edits" && (
                      <p className="text-[11px] text-amber-400/80 mt-0.5 truncate">{changeDesc}</p>
                    )}
                  </div>

                  {/* Actions */}
                  {!batchMode && (
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        className="p-1.5 rounded hover:bg-accent/40 transition-colors"
                        onClick={(e) => handleToggleFavorite(e, job.id)}
                        title={favorited ? "Remove from favorites" : "Add to favorites"}
                      >
                        <Star className={`w-4 h-4 ${favorited ? "fill-amber-400 text-amber-400" : "text-muted-foreground"}`} />
                      </button>
                      {resultUrl && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={(e) => {
                            e.stopPropagation();
                            downloadImage(resultUrl, `${job.title}-result.png`);
                          }}
                          title="Download result"
                        >
                          <Download className="w-4 h-4" />
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedJob(job);
                        }}
                        title="View details"
                      >
                        <Eye className="w-4 h-4" />
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-2">
          <p className="text-xs text-muted-foreground">
            Page {page + 1} of {totalPages}
          </p>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" className="h-8 w-8" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
              <ChevronLeft className="w-4 h-4" />
            </Button>
            {(() => {
              const pages: (number | "...")[] = [];
              if (totalPages <= 7) {
                for (let i = 0; i < totalPages; i++) pages.push(i);
              } else {
                pages.push(0);
                if (page > 3) pages.push("...");
                const start = Math.max(1, page - 1);
                const end = Math.min(totalPages - 2, page + 1);
                for (let i = start; i <= end; i++) pages.push(i);
                if (page < totalPages - 4) pages.push("...");
                pages.push(totalPages - 1);
              }
              return pages.map((p, idx) =>
                p === "..." ? (
                  <span key={`e-${idx}`} className="px-1.5 text-xs text-muted-foreground">...</span>
                ) : (
                  <Button
                    key={p}
                    variant={p === page ? "default" : "outline"}
                    size="icon"
                    className="h-8 w-8 text-xs"
                    onClick={() => setPage(p)}
                  >
                    {p + 1}
                  </Button>
                )
              );
            })()}
            <Button variant="outline" size="icon" className="h-8 w-8" disabled={page >= totalPages - 1} onClick={() => setPage((p) => p + 1)}>
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Detail Modal */}
      <Dialog open={!!selectedJob} onOpenChange={(open) => { if (!open) setSelectedJob(null); }}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          {selectedJob && (() => {
            const favorited = isFavorite(selectedJob.id);
            return (
              <>
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    {selectedJob.title}
                    <Badge
                      variant={
                        selectedJob.status === "done" ? "default" :
                        selectedJob.status === "failed" ? "destructive" : "secondary"
                      }
                    >
                      {selectedJob.status}
                    </Badge>
                    <button
                      className="ml-auto p-1.5 rounded hover:bg-accent/40 transition-colors"
                      onClick={(e) => handleToggleFavorite(e, selectedJob.id)}
                      title={favorited ? "Remove from favorites" : "Add to favorites"}
                    >
                      <Star className={`w-5 h-5 ${favorited ? "fill-amber-400 text-amber-400" : "text-muted-foreground"}`} />
                    </button>
                  </DialogTitle>
                </DialogHeader>

                {/* Before/After comparison */}
                <div className="mt-4">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                    Before / After Comparison
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <p className="text-[11px] text-muted-foreground text-center">Original</p>
                      <div className="aspect-[3/4] rounded-lg overflow-hidden bg-muted border border-border">
                        <img
                          src={selectedJob.originalUrl}
                          alt="Original"
                          className="w-full h-full object-cover"
                        />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <p className="text-[11px] text-muted-foreground text-center">Result</p>
                      <div className="aspect-[3/4] rounded-lg overflow-hidden bg-muted border border-border">
                        {selectedJob.variations?.[0]?.resultUrl ? (
                          <img
                            src={selectedJob.variations[0].resultUrl}
                            alt="Result"
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-muted-foreground text-sm">
                            No result available
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Metadata grid */}
                <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                  <div className="flex items-start gap-2.5">
                    <Clock className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                    <div>
                      <p className="text-muted-foreground text-xs font-medium">Created</p>
                      <p>{new Date(selectedJob.createdAt).toLocaleString()}</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-2.5">
                    <Zap className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                    <div>
                      <p className="text-muted-foreground text-xs font-medium">Credits Used</p>
                      <p>{selectedJob.creditsUsed ?? 0} credits</p>
                    </div>
                  </div>

                  {selectedJob.controls && (
                    <div className="flex items-start gap-2.5 sm:col-span-2">
                      <Palette className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                      <div>
                        <p className="text-muted-foreground text-xs font-medium">Edits Applied</p>
                        <p className="text-amber-400">{describeControls(selectedJob.controls)}</p>
                      </div>
                    </div>
                  )}

                  {selectedJob.instruction && (
                    <div className="flex items-start gap-2.5 sm:col-span-2">
                      <FileText className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                      <div className="min-w-0">
                        <p className="text-muted-foreground text-xs font-medium">AI Prompt</p>
                        <p className="text-xs leading-relaxed whitespace-pre-wrap break-words max-h-40 overflow-y-auto mt-1 bg-accent/20 rounded-md p-2">
                          {selectedJob.instruction}
                        </p>
                      </div>
                    </div>
                  )}

                  {selectedJob.detectedElements?.length > 0 && (
                    <div className="flex items-start gap-2.5 sm:col-span-2">
                      <ImageIcon className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                      <div>
                        <p className="text-muted-foreground text-xs font-medium">Detected Elements</p>
                        <div className="flex flex-wrap gap-1.5 mt-1">
                          {selectedJob.detectedElements.map((el: string) => (
                            <span
                              key={el}
                              className="rounded-full bg-secondary px-2.5 py-0.5 text-[11px] text-secondary-foreground"
                            >
                              {el}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Action buttons */}
                <div className="mt-6 flex flex-wrap gap-2 border-t border-border pt-4">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => downloadImage(selectedJob.originalUrl, `${selectedJob.title}-original.png`)}
                  >
                    <Download className="w-3.5 h-3.5 mr-1.5" />
                    Download Original
                  </Button>
                  {selectedJob.variations?.[0]?.resultUrl && (
                    <Button
                      size="sm"
                      onClick={() => downloadImage(selectedJob.variations[0].resultUrl, `${selectedJob.title}-result.png`)}
                    >
                      <Download className="w-3.5 h-3.5 mr-1.5" />
                      Download Result
                    </Button>
                  )}
                  {/* Re-run button */}
                  {selectedJob.controls && selectedJob.status === "done" && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleRerun(selectedJob)}
                      disabled={rerunMutation.isPending}
                    >
                      <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
                      Re-run Same Settings
                    </Button>
                  )}
                </div>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* Re-run confirmation dialog */}
      <AlertDialog open={!!rerunConfirmJob} onOpenChange={(open) => { if (!open) setRerunConfirmJob(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Re-run with same settings?</AlertDialogTitle>
            <AlertDialogDescription>
              This will create a new generation job using the same image and control settings as "{rerunConfirmJob?.title}".
              Credits will be deducted from your balance.
              {rerunConfirmJob?.controls && (
                <span className="block mt-2 text-amber-400 font-medium">
                  Settings: {describeControls(rerunConfirmJob.controls)}
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmRerun} disabled={rerunMutation.isPending}>
              {rerunMutation.isPending ? (
                <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
              ) : (
                <RotateCcw className="w-4 h-4 mr-1.5" />
              )}
              Confirm Re-run
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
