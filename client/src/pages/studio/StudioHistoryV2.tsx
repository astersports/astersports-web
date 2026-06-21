/**
 * StudioHistory — Full redesign: 10/10 experience
 * Features:
 * - Stats dashboard cards (total, credits, success rate, top type)
 * - Recent strip with hover before/after crossfade
 * - Archive table with search, filters (status, type, date range, member), sort, pagination
 * - Full-screen detail slideshow with keyboard navigation
 * - Batch operations (multi-select, download ZIP, bulk favorite)
 * - Micro-interactions: staggered entrance, hover scale, pulse processing, star bounce
 * - Responsive: mobile card list, tablet condensed table, desktop full table
 */

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { useTenant } from "@/contexts/TenantContext";
import { toast } from "sonner";
import {
  Search,
  Star,
  Download,
  Eye,
  ChevronLeft,
  ChevronRight,
  X,
  ArrowUpDown,
  Calendar,
  Users,
  Filter,
  CheckSquare,
  Square,
  Package,
  Zap,
  TrendingUp,
  Palette,
  RotateCcw,
  Maximize2,
  Heart,
  Loader2,
  ImageIcon,
  RefreshCw,
  FileText,
} from "lucide-react";
import { generateLookbookPdf, type LookbookItem } from "@/lib/lookbookPdf";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useFilterParams } from "@/hooks/useFilterParams";

// ─── Types ──────────────────────────────────────────────────────────────────

interface Job {
  id: number;
  title: string;
  originalUrl: string;
  status: string;
  creditsUsed: number | null;
  createdAt: Date;
  detectedElements: string[];
  controls: any;
  instruction: string | null;
  userName: string;
  userId: number;
  variations: Array<{ id: number; resultUrl: string; round: number; createdAt: Date }>;
}

type EditType = "Density" | "Scale" | "Recolor" | "Remove" | "Upload" | "Mixed";

// ─── Utility Functions ──────────────────────────────────────────────────────

function getEditType(controls: any): EditType {
  if (!controls) return "Upload";
  const enabled: string[] = [];
  // Check both "enabled" flag and non-zero percent for each control
  if (controls.density?.enabled && controls.density.percent !== 0) enabled.push("Density");
  if (controls.scale?.enabled && controls.scale.percent !== 0) enabled.push("Scale");
  if (controls.recolor?.enabled && (controls.recolor.targetColor || controls.recolor.fromColor)) enabled.push("Recolor");
  if (controls.remove?.enabled && controls.remove.element) enabled.push("Remove");
  if (enabled.length === 0) {
    // Fallback: check if any is enabled regardless of value
    if (controls.density?.enabled) enabled.push("Density");
    if (controls.scale?.enabled) enabled.push("Scale");
    if (controls.recolor?.enabled) enabled.push("Recolor");
    if (controls.remove?.enabled) enabled.push("Remove");
  }
  if (enabled.length === 0) return "Upload";
  if (enabled.length === 1) return enabled[0] as EditType;
  return "Mixed";
}

function getTypeColor(type: EditType): string {
  switch (type) {
    case "Density": return "bg-amber-500/20 text-amber-400 border-amber-500/30";
    case "Scale": return "bg-blue-500/20 text-blue-400 border-blue-500/30";
    case "Recolor": return "bg-purple-500/20 text-purple-400 border-purple-500/30";
    case "Remove": return "bg-red-500/20 text-red-400 border-red-500/30";
    case "Upload": return "bg-slate-500/20 text-slate-400 border-slate-500/30";
    case "Mixed": return "bg-emerald-500/20 text-emerald-400 border-emerald-500/30";
  }
}

function getTypeIcon(type: EditType) {
  switch (type) {
    case "Density": return <Zap className="w-3 h-3" />;
    case "Scale": return <Maximize2 className="w-3 h-3" />;
    case "Recolor": return <Palette className="w-3 h-3" />;
    case "Remove": return <X className="w-3 h-3" />;
    case "Upload": return <ImageIcon className="w-3 h-3" />;
    case "Mixed": return <Package className="w-3 h-3" />;
  }
}

function relativeTime(date: Date): string {
  const now = new Date();
  const diff = now.getTime() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 4) return `${weeks}w ago`;
  return new Date(date).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function describeChanges(controls: any): string {
  if (!controls) return "";
  const parts: string[] = [];
  if (controls.density?.enabled) {
    const pct = controls.density.percent ?? controls.density.percentage ?? 0;
    parts.push(`Density ${pct > 0 ? "+" : ""}${pct}%`);
  }
  if (controls.scale?.enabled) {
    const pct = controls.scale.percent ?? controls.scale.percentage ?? 0;
    parts.push(`Scale ${pct > 0 ? "+" : ""}${pct}%`);
  }
  if (controls.recolor?.enabled) {
    const target = controls.recolor.targetColor || controls.recolor.targetDescription || controls.recolor.fromColor;
    parts.push(`Recolor → ${target || "custom"}`);
  }
  if (controls.remove?.enabled) {
    const el = controls.remove.element || "element";
    const pct = controls.remove.percent;
    parts.push(`Remove "${el}"${pct ? ` ${pct}%` : ""}`);
  }
  return parts.join(" · ") || "Upload";
}

function getResultUrl(job: Job): string | null {
  if (job.variations.length === 0) return null;
  const sorted = [...job.variations].sort((a, b) => b.round - a.round);
  return sorted[0].resultUrl;
}

// ─── Stats Dashboard ────────────────────────────────────────────────────────

function StatCard({ icon, label, value, accent }: { icon: React.ReactNode; label: string; value: string | number; accent: string }) {
  return (
    <div className="relative overflow-hidden rounded-xl border border-white/5 bg-white/[0.02] backdrop-blur-sm p-4 group hover:border-white/10 transition-all duration-200">
      <div className="absolute top-0 right-0 w-20 h-20 opacity-5 group-hover:opacity-10 transition-opacity">
        <div className={`w-full h-full rounded-full ${accent} blur-2xl`} />
      </div>
      <div className="flex items-center gap-3">
        <div className={`p-2 rounded-lg ${accent} bg-opacity-10`}>
          {icon}
        </div>
        <div>
          <p className="text-2xl font-bold text-white tracking-tight">{value}</p>
          <p className="text-xs text-slate-400 mt-0.5">{label}</p>
        </div>
      </div>
    </div>
  );
}

function StatsRow() {
  const { tenant } = useTenant();
  const { data: stats, isLoading } = trpc.studio.historyStats.useQuery(
    { tenantId: tenant?.id ?? 0 },
    { enabled: !!tenant?.id }
  );

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-[76px] rounded-xl border border-white/5 bg-white/[0.02] animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
      <StatCard
        icon={<Package className="w-4 h-4 text-blue-400" />}
        label="Total Generations"
        value={stats?.totalJobs ?? 0}
        accent="bg-blue-500"
      />
      <StatCard
        icon={<Zap className="w-4 h-4 text-amber-400" />}
        label="Credits Spent"
        value={stats?.creditsSpent?.toLocaleString() ?? "0"}
        accent="bg-amber-500"
      />
      <StatCard
        icon={<TrendingUp className="w-4 h-4 text-emerald-400" />}
        label="Success Rate"
        value={`${stats?.successRate ?? 0}%`}
        accent="bg-emerald-500"
      />
      <StatCard
        icon={<Palette className="w-4 h-4 text-purple-400" />}
        label="Top Edit Type"
        value={stats?.topType ?? "None"}
        accent="bg-purple-500"
      />
    </div>
  );
}

// ─── Recent Strip ───────────────────────────────────────────────────────────

function RecentStrip({ onSelect }: { onSelect: (job: Job, index: number) => void }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(true);

  const { tenant } = useTenant();
  const { data } = trpc.studio.historyArchive.useQuery(
    {
      tenantId: tenant?.id ?? 0,
      limit: 12,
      offset: 0,
      status: "done",
      sortBy: "date",
      sortDir: "desc",
    },
    { enabled: !!tenant?.id }
  );

  const recentJobs = data?.jobs ?? [];

  const updateScrollState = useCallback(() => {
    if (!scrollRef.current) return;
    const { scrollLeft, scrollWidth, clientWidth } = scrollRef.current;
    setCanScrollLeft(scrollLeft > 5);
    setCanScrollRight(scrollLeft < scrollWidth - clientWidth - 5);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener("scroll", updateScrollState);
    updateScrollState();
    return () => el.removeEventListener("scroll", updateScrollState);
  }, [updateScrollState, recentJobs]);

  const scroll = (dir: "left" | "right") => {
    if (!scrollRef.current) return;
    const amount = dir === "left" ? -320 : 320;
    scrollRef.current.scrollBy({ left: amount, behavior: "smooth" });
  };

  if (recentJobs.length === 0) return null;

  return (
    <div className="mb-8">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-slate-300 uppercase tracking-wider">Recent</h3>
        <div className="flex gap-1">
          <button
            onClick={() => scroll("left")}
            disabled={!canScrollLeft}
            className="p-1.5 rounded-md border border-white/10 text-slate-400 hover:text-white hover:border-white/20 disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-150"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            onClick={() => scroll("right")}
            disabled={!canScrollRight}
            className="p-1.5 rounded-md border border-white/10 text-slate-400 hover:text-white hover:border-white/20 disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-150"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div
        ref={scrollRef}
        className="flex gap-3 overflow-x-auto scrollbar-hide pb-2 -mx-1 px-1"
        style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
      >
        {recentJobs.map((job, idx) => (
          <RecentCard key={job.id} job={job} index={idx} onClick={() => onSelect(job, idx)} />
        ))}
      </div>
    </div>
  );
}

function RecentCard({ job, index, onClick }: { job: Job; index: number; onClick: () => void }) {
  const [hovered, setHovered] = useState(false);
  const resultUrl = getResultUrl(job);
  const type = getEditType(job.controls);

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="flex-shrink-0 w-[180px] group relative rounded-xl overflow-hidden border border-white/5 hover:border-white/15 transition-all duration-200 hover:shadow-lg hover:shadow-black/20 focus:outline-none focus:ring-2 focus:ring-amber-500/50"
      style={{
        animationDelay: `${index * 50}ms`,
        animation: "fadeSlideUp 0.4s ease-out both",
      }}
    >
      <div className="relative aspect-[3/4] bg-slate-900">
        {/* Original image */}
        <img
          src={job.originalUrl}
          alt={job.title}
          className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-300 ${
            hovered && resultUrl ? "opacity-0" : "opacity-100"
          }`}
          loading="lazy"
        />
        {/* Result image (shown on hover) */}
        {resultUrl && (
          <img
            src={resultUrl}
            alt={`${job.title} result`}
            className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-300 ${
              hovered ? "opacity-100" : "opacity-0"
            }`}
            loading="lazy"
          />
        )}
        {/* Hover indicator */}
        <div className={`absolute top-2 right-2 px-1.5 py-0.5 rounded text-[10px] font-medium bg-black/60 backdrop-blur-sm text-white transition-opacity duration-200 ${hovered ? "opacity-100" : "opacity-0"}`}>
          {hovered ? "After" : "Before"}
        </div>
        {/* Type badge */}
        <div className={`absolute top-2 left-2 px-1.5 py-0.5 rounded text-[10px] font-medium border ${getTypeColor(type)} backdrop-blur-sm flex items-center gap-1`}>
          {getTypeIcon(type)}
          {type}
        </div>
        {/* Bottom gradient overlay */}
        <div className="absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-black/80 to-transparent" />
        {/* Title and time */}
        <div className="absolute bottom-0 left-0 right-0 p-2.5">
          <p className="text-xs font-medium text-white truncate">{job.title}</p>
          <p className="text-[10px] text-slate-300 mt-0.5">{relativeTime(job.createdAt)}</p>
        </div>
      </div>
    </button>
  );
}

// ─── Detail Slideshow Modal ─────────────────────────────────────────────────

function DetailSlideshow({
  jobs,
  initialIndex,
  onClose,
  favoriteIds,
  onToggleFavorite,
}: {
  jobs: Job[];
  initialIndex: number;
  onClose: () => void;
  favoriteIds: Set<number>;
  onToggleFavorite: (jobId: number) => void;
}) {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [showAfter, setShowAfter] = useState(true);
  const job = jobs[currentIndex];

  const goNext = useCallback(() => {
    setCurrentIndex((i) => Math.min(i + 1, jobs.length - 1));
  }, [jobs.length]);

  const goPrev = useCallback(() => {
    setCurrentIndex((i) => Math.max(i - 1, 0));
  }, []);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      switch (e.key) {
        case "Escape": onClose(); break;
        case "ArrowRight": goNext(); break;
        case "ArrowLeft": goPrev(); break;
        case "f": case "F": onToggleFavorite(job.id); break;
        case " ": e.preventDefault(); setShowAfter((s) => !s); break;
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose, goNext, goPrev, job?.id, onToggleFavorite]);

  if (!job) return null;

  const resultUrl = getResultUrl(job);
  const type = getEditType(job.controls);
  const isFav = favoriteIds.has(job.id);

  return (
    <div className="fixed inset-0 z-50 bg-black/95 backdrop-blur-xl flex flex-col" onClick={onClose}>
      {/* Header - responsive */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between px-3 sm:px-6 py-3 sm:py-4 border-b border-white/5 gap-2" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 sm:gap-3 min-w-0 overflow-hidden">
          <span className={`px-2 py-0.5 rounded text-[10px] sm:text-xs font-medium border flex-shrink-0 ${getTypeColor(type)} flex items-center gap-1`}>
            {getTypeIcon(type)} {type}
          </span>
          <h3 className="text-white font-medium text-sm sm:text-base truncate">{job.title}</h3>
          <span className="text-slate-500 text-xs sm:text-sm hidden sm:inline">·</span>
          <span className="text-slate-400 text-xs sm:text-sm hidden sm:inline">{relativeTime(job.createdAt)}</span>
          <span className="text-slate-500 text-xs sm:text-sm hidden sm:inline">·</span>
          <span className="text-slate-400 text-xs sm:text-sm hidden sm:inline">by {job.userName}</span>
        </div>
        <div className="flex items-center gap-1.5 sm:gap-2 flex-shrink-0">
          <span className="text-[10px] sm:text-xs text-slate-500 mr-1 sm:mr-2">
            {currentIndex + 1}/{jobs.length}
          </span>
          <button
            onClick={(e) => { e.stopPropagation(); onToggleFavorite(job.id); }}
            className={`p-1.5 sm:p-2 rounded-lg border transition-all duration-200 ${
              isFav
                ? "border-amber-500/30 bg-amber-500/10 text-amber-400"
                : "border-white/10 text-slate-400 hover:text-white hover:border-white/20"
            }`}
            title="Favorite (F)"
          >
            <Star className={`w-4 h-4 ${isFav ? "fill-amber-400" : ""}`} />
          </button>
          <a
            href={resultUrl || job.originalUrl}
            download
            onClick={(e) => e.stopPropagation()}
            className="p-1.5 sm:p-2 rounded-lg border border-white/10 text-slate-400 hover:text-white hover:border-white/20 transition-all duration-200"
            title="Download (D)"
          >
            <Download className="w-4 h-4" />
          </a>
          <button
            onClick={onClose}
            className="p-1.5 sm:p-2 rounded-lg border border-white/10 text-slate-400 hover:text-white hover:border-white/20 transition-all duration-200"
            title="Close (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex items-center justify-center relative px-4 sm:px-16" onClick={(e) => e.stopPropagation()}>
        {/* Prev button */}
        <button
          onClick={goPrev}
          disabled={currentIndex === 0}
          className="absolute left-1 sm:left-4 p-2 sm:p-3 rounded-full border border-white/10 text-white hover:bg-white/5 disabled:opacity-20 disabled:cursor-not-allowed transition-all z-10"
        >
          <ChevronLeft className="w-4 h-4 sm:w-5 sm:h-5" />
        </button>

        {/* Image comparison - stacks vertically on mobile */}
        <div className="flex flex-col sm:flex-row gap-3 sm:gap-6 max-w-5xl w-full justify-center items-center overflow-y-auto max-h-[70vh] sm:max-h-none">
          <div className="flex-1 w-full sm:max-w-md">
            <p className="text-[10px] sm:text-xs text-slate-500 uppercase tracking-wider mb-1.5 sm:mb-2 text-center">Original</p>
            <div className="rounded-xl overflow-hidden border border-white/10 bg-slate-900">
              <img src={job.originalUrl} alt="Original" className="w-full h-auto max-h-[35vh] sm:max-h-[60vh] object-contain" />
            </div>
          </div>
          {resultUrl && (
            <div className="flex-1 w-full sm:max-w-md">
              <p className="text-[10px] sm:text-xs text-slate-500 uppercase tracking-wider mb-1.5 sm:mb-2 text-center">Result</p>
              <div className="rounded-xl overflow-hidden border border-white/10 bg-slate-900">
                <img src={resultUrl} alt="Result" className="w-full h-auto max-h-[35vh] sm:max-h-[60vh] object-contain" />
              </div>
            </div>
          )}
        </div>

        {/* Next button */}
        <button
          onClick={goNext}
          disabled={currentIndex === jobs.length - 1}
          className="absolute right-1 sm:right-4 p-2 sm:p-3 rounded-full border border-white/10 text-white hover:bg-white/5 disabled:opacity-20 disabled:cursor-not-allowed transition-all z-10"
        >
          <ChevronRight className="w-4 h-4 sm:w-5 sm:h-5" />
        </button>
      </div>

      {/* Footer metadata - responsive */}
      <div className="px-3 sm:px-6 py-2 sm:py-3 border-t border-white/5 flex flex-col sm:flex-row sm:items-center justify-between gap-1" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 sm:gap-4 text-[10px] sm:text-xs text-slate-400 flex-wrap">
          <span>{describeChanges(job.controls)}</span>
          {job.creditsUsed && <span>· {job.creditsUsed} credits</span>}
          {job.detectedElements?.length > 0 && (
            <span className="hidden sm:inline">· Elements: {job.detectedElements.slice(0, 3).join(", ")}</span>
          )}
        </div>
        <div className="text-[10px] sm:text-xs text-slate-500 hidden sm:block">
          ← → Navigate · Space Toggle · F Favorite · Esc Close
        </div>
      </div>
    </div>
  );
}

// ─── Archive Table ──────────────────────────────────────────────────────────

function ArchiveTable({
  onSelectJob,
  favoriteIds,
  onToggleFavorite,
}: {
  onSelectJob: (job: Job, index: number) => void;
  favoriteIds: Set<number>;
  onToggleFavorite: (jobId: number) => void;
}) {
  const filters = useFilterParams();
  const { search, status, type: typeFilter, sortBy, sortDir, page, favorites: favoritesOnly } = filters;
  const { setSearch: setSearchParam, setStatus: setStatusParam, setType: setTypeParam, setSortBy: setSortByParam, setSortDir: setSortDirParam, setPage, setFavorites: setFavoritesOnly, clearAll, hasActiveFilters } = filters;

  const [localSearch, setLocalSearch] = useState(search);
  const [debouncedSearch, setDebouncedSearch] = useState(search);
  const [userId, setUserId] = useState<number | undefined>(undefined);
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [showFilters, setShowFilters] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState("");
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
  const [pdfProgress, setPdfProgress] = useState("");
  const [showLookbookDialog, setShowLookbookDialog] = useState(false);
  const [lookbookTitle, setLookbookTitle] = useState("Design Lookbook");
  const [lookbookSubtitle, setLookbookSubtitle] = useState("Before & After Comparison");
  const [lookbookClient, setLookbookClient] = useState("");
  const limit = 20;

  // Debounce local search → URL param + query
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(localSearch);
      setSearchParam(localSearch);
    }, 300);
    return () => clearTimeout(timer);
  }, [localSearch, setSearchParam]);

  // Sync URL search back to local input when navigating
  useEffect(() => { setLocalSearch(search); }, [search]);

  const { tenant } = useTenant();
  const { data: stats } = trpc.studio.historyStats.useQuery(
    { tenantId: tenant?.id ?? 0 },
    { enabled: !!tenant?.id }
  );
  const members = stats?.members ?? [];

  const { data, isLoading, isFetching } = trpc.studio.historyArchive.useQuery(
    {
      tenantId: tenant?.id ?? 0,
      limit,
      offset: page * limit,
      status: status !== "all" ? status : undefined,
      search: debouncedSearch || undefined,
      sortBy: sortBy as "date" | "credits" | "title",
      sortDir: sortDir as "asc" | "desc",
      userId,
      startDate: startDate ? new Date(startDate).getTime() : undefined,
      endDate: endDate ? new Date(endDate + "T23:59:59").getTime() : undefined,
    },
    { enabled: !!tenant?.id }
  );

  const jobs = useMemo(() => {
    if (!data?.jobs) return [];
    if (typeFilter === "all") return data.jobs;
    return data.jobs.filter((j) => getEditType(j.controls).toLowerCase() === typeFilter);
  }, [data?.jobs, typeFilter]);

  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / limit);

  // Batch selection
  const toggleSelect = (id: number, shiftKey: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const selectAll = () => {
    if (selectedIds.size === jobs.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(jobs.map((j) => j.id)));
    }
  };

  const toggleSort = (field: "date" | "credits" | "title") => {
    if (sortBy === field) {
      setSortDirParam(sortDir === "desc" ? "asc" : "desc");
    } else {
      setSortByParam(field);
      setSortDirParam("desc");
    }
  };

  // Batch ZIP download
  const handleBatchDownload = async () => {
    const selectedJobs = jobs.filter((j) => selectedIds.has(j.id));
    const items = selectedJobs
      .filter((j) => {
        const resultUrl = j.variations?.length > 0
          ? [...j.variations].sort((a: any, b: any) => b.round - a.round)[0]?.resultUrl
          : null;
        return !!resultUrl;
      })
      .map((j) => {
        const resultUrl = [...j.variations].sort((a: any, b: any) => b.round - a.round)[0].resultUrl;
        const safeName = j.title.replace(/[^a-zA-Z0-9_-]/g, "_");
        return { url: resultUrl, filename: `${safeName}-result.png` };
      });

    if (items.length === 0) {
      toast.error("No downloadable results", { description: "Selected jobs have no result images yet." });
      return;
    }

    setIsDownloading(true);
    setDownloadProgress(`Fetching 0/${items.length}...`);

    try {
      const JSZip = (await import("jszip")).default;
      const zip = new JSZip();
      let fetched = 0;

      const results = await Promise.allSettled(
        items.map(async (item) => {
          const resp = await fetch(item.url);
          if (!resp.ok) throw new Error(`Failed: ${item.filename}`);
          const blob = await resp.blob();
          zip.file(item.filename, blob);
          fetched++;
          setDownloadProgress(`Fetching ${fetched}/${items.length}...`);
        })
      );

      const succeeded = results.filter((r) => r.status === "fulfilled").length;
      if (succeeded === 0) throw new Error("No files could be downloaded");

      setDownloadProgress("Compressing...");
      const content = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(content);
      const a = document.createElement("a");
      a.href = url;
      a.download = `aster-generations-${new Date().toISOString().slice(0, 10)}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast.success("Download complete", {
        description: `${succeeded}/${items.length} images packaged into ZIP.`,
      });
      setSelectedIds(new Set());
    } catch (err: any) {
      toast.error("Download failed", { description: err.message });
    } finally {
      setIsDownloading(false);
      setDownloadProgress("");
    }
  };

  // Open lookbook dialog (validate selection first)
  const handleOpenLookbookDialog = () => {
    const selectedJobs = jobs.filter((j) => selectedIds.has(j.id));
    const hasResults = selectedJobs.some((j) => getResultUrl(j));
    if (!hasResults) {
      toast.error("No items with results", { description: "Selected jobs have no result images yet." });
      return;
    }
    // Pre-fill defaults
    setLookbookTitle("Design Lookbook");
    setLookbookSubtitle(`${selectedJobs.filter((j) => getResultUrl(j)).length} design${selectedJobs.filter((j) => getResultUrl(j)).length !== 1 ? "s" : ""} · ${new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" })}`);
    setLookbookClient("");
    setShowLookbookDialog(true);
  };

  // Generate Lookbook PDF (called from dialog confirm)
  const handleConfirmLookbook = async () => {
    setShowLookbookDialog(false);
    const selectedJobs = jobs.filter((j) => selectedIds.has(j.id));
    const lookbookItems: LookbookItem[] = selectedJobs
      .filter((j) => {
        const resultUrl = getResultUrl(j);
        return !!resultUrl;
      })
      .map((j) => ({
        title: j.title,
        originalUrl: j.originalUrl,
        resultUrl: getResultUrl(j)!,
        editType: getEditType(j.controls),
        changes: describeChanges(j.controls),
        creditsUsed: j.creditsUsed,
        createdAt: j.createdAt,
        userName: j.userName || "Unknown",
      }));

    setIsGeneratingPdf(true);
    setPdfProgress("Preparing...");

    try {
      await generateLookbookPdf({
        title: lookbookTitle || "Design Lookbook",
        subtitle: lookbookSubtitle || "Before & After Comparison",
        tenantName: lookbookClient || tenant?.name || undefined,
        items: lookbookItems,
        onProgress: (current, total, stage) => {
          setPdfProgress(stage);
        },
      });
      toast.success("Lookbook generated", {
        description: `${lookbookItems.length} design${lookbookItems.length !== 1 ? "s" : ""} exported to PDF.`,
      });
    } catch (err: any) {
      toast.error("PDF generation failed", { description: err.message });
    } finally {
      setIsGeneratingPdf(false);
      setPdfProgress("");
    }
  };

  return (
    <div>
      {/* Section header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-medium text-slate-300 uppercase tracking-wider">Archive</h3>
          <span className="text-xs text-slate-500 bg-white/5 px-2 py-0.5 rounded-full">{total} total</span>
          {isFetching && <Loader2 className="w-3 h-3 text-slate-500 animate-spin" />}
        </div>
        <div className="flex items-center gap-2">
          {selectedIds.size > 0 && (
            <div className="flex items-center gap-2 mr-2 px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20">
              <span className="text-xs text-amber-400 font-medium">{selectedIds.size} selected</span>
              <button
                onClick={handleBatchDownload}
                disabled={isDownloading}
                className="inline-flex items-center gap-1 text-xs text-amber-400 hover:text-amber-300 underline disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isDownloading ? (
                  <><Loader2 className="w-3 h-3 animate-spin" />{downloadProgress || "Downloading..."}</>
                ) : (
                  <><Download className="w-3 h-3" />Download ZIP</>
                )}
              </button>
              <span className="text-slate-600">|</span>
              <button
                onClick={handleOpenLookbookDialog}
                disabled={isGeneratingPdf}
                className="inline-flex items-center gap-1 text-xs text-amber-400 hover:text-amber-300 underline disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isGeneratingPdf ? (
                  <><Loader2 className="w-3 h-3 animate-spin" />{pdfProgress || "Generating..."}</>
                ) : (
                  <><FileText className="w-3 h-3" />Lookbook PDF</>
                )}
              </button>
              <span className="text-slate-600">|</span>
              <button
                onClick={() => {
                  selectedIds.forEach((id) => onToggleFavorite(id));
                  setSelectedIds(new Set());
                }}
                className="inline-flex items-center gap-1 text-xs text-amber-400 hover:text-amber-300 underline"
              >
                <Star className="w-3 h-3" />Favorite all
              </button>
              <span className="text-slate-600">|</span>
              <button
                onClick={() => setSelectedIds(new Set())}
                className="text-xs text-slate-500 hover:text-slate-300"
              >
                Clear
              </button>
            </div>
          )}
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`p-2 rounded-lg border transition-all duration-200 ${
              showFilters ? "border-amber-500/30 bg-amber-500/10 text-amber-400" : "border-white/10 text-slate-400 hover:text-white hover:border-white/20"
            }`}
            title="Toggle filters"
          >
            <Filter className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Search and filters bar */}
      <div className="space-y-3 mb-4">
        <div className="flex gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <input
              type="text"
              value={localSearch}
              onChange={(e) => setLocalSearch(e.target.value)}
              placeholder="Search prompts, titles, elements..."
              className="w-full pl-9 pr-4 py-2.5 rounded-lg bg-white/[0.03] border border-white/10 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-amber-500/40 focus:ring-1 focus:ring-amber-500/20 transition-all"
            />
          </div>
          <select
            value={status}
            onChange={(e) => setStatusParam(e.target.value)}
            className="px-3 py-2.5 rounded-lg bg-white/[0.03] border border-white/10 text-sm text-slate-300 focus:outline-none focus:border-amber-500/40 appearance-none cursor-pointer min-w-[120px]"
          >
            <option value="all">All Status</option>
            <option value="done">Done</option>
            <option value="failed">Failed</option>
            <option value="processing">Processing</option>
            <option value="pending">Pending</option>
          </select>
          <select
            value={typeFilter}
            onChange={(e) => setTypeParam(e.target.value)}
            className="px-3 py-2.5 rounded-lg bg-white/[0.03] border border-white/10 text-sm text-slate-300 focus:outline-none focus:border-amber-500/40 appearance-none cursor-pointer min-w-[120px]"
          >
            <option value="all">All Types</option>
            <option value="density">Density</option>
            <option value="scale">Scale</option>
            <option value="recolor">Recolor</option>
            <option value="remove">Remove</option>
            <option value="upload">Upload</option>
          </select>
        </div>

        {/* Advanced filters (collapsible) */}
        {showFilters && (
          <div className="flex gap-3 items-center p-3 rounded-lg bg-white/[0.02] border border-white/5 animate-in slide-in-from-top-2 duration-200">
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-slate-500" />
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="px-2 py-1.5 rounded bg-white/[0.03] border border-white/10 text-xs text-slate-300 focus:outline-none focus:border-amber-500/40"
              />
              <span className="text-xs text-slate-500">to</span>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="px-2 py-1.5 rounded bg-white/[0.03] border border-white/10 text-xs text-slate-300 focus:outline-none focus:border-amber-500/40"
              />
            </div>
            {members.length > 1 && (
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-slate-500" />
                <select
                  value={userId ?? ""}
                  onChange={(e) => setUserId(e.target.value ? Number(e.target.value) : undefined)}
                  className="px-2 py-1.5 rounded bg-white/[0.03] border border-white/10 text-xs text-slate-300 focus:outline-none focus:border-amber-500/40 appearance-none cursor-pointer"
                >
                  <option value="">All Members</option>
                  {members.map((m) => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </select>
              </div>
            )}
            {(startDate || endDate || userId) && (
              <button
                onClick={() => { setStartDate(""); setEndDate(""); setUserId(undefined); }}
                className="text-xs text-slate-400 hover:text-white underline ml-auto"
              >
                Clear filters
              </button>
            )}
          </div>
        )}
      </div>

      {/* Table */}
      <div className="rounded-xl border border-white/5 overflow-hidden">
        {/* Table header */}
        <div className="hidden md:grid grid-cols-[40px_56px_1fr_100px_1.2fr_100px_80px_70px_80px_90px] gap-2 px-4 py-2.5 bg-white/[0.02] border-b border-white/5 text-xs text-slate-500 font-medium uppercase tracking-wider">
          <div className="flex items-center">
            <button onClick={selectAll} className="text-slate-500 hover:text-white transition-colors">
              {selectedIds.size === jobs.length && jobs.length > 0 ? <CheckSquare className="w-3.5 h-3.5" /> : <Square className="w-3.5 h-3.5" />}
            </button>
          </div>
          <div>Preview</div>
          <button onClick={() => toggleSort("title")} className="flex items-center gap-1 hover:text-white transition-colors text-left">
            Title {sortBy === "title" && <ArrowUpDown className="w-3 h-3" />}
          </button>
          <div>Type</div>
          <div>Changes</div>
          <div>Created by</div>
          <button onClick={() => toggleSort("date")} className="flex items-center gap-1 hover:text-white transition-colors">
            Date {sortBy === "date" && <ArrowUpDown className="w-3 h-3" />}
          </button>
          <button onClick={() => toggleSort("credits")} className="flex items-center gap-1 hover:text-white transition-colors">
            Credits {sortBy === "credits" && <ArrowUpDown className="w-3 h-3" />}
          </button>
          <div>Status</div>
          <div className="text-right">Actions</div>
        </div>

        {/* Loading skeleton */}
        {isLoading && (
          <div className="divide-y divide-white/5">
            {[...Array(8)].map((_, i) => (
              <div key={i} className="h-14 px-4 flex items-center">
                <div className="w-full h-4 bg-white/5 rounded animate-pulse" style={{ animationDelay: `${i * 80}ms` }} />
              </div>
            ))}
          </div>
        )}

        {/* Table rows */}
        {!isLoading && jobs.length === 0 && (
          <div className="py-16 text-center">
            <ImageIcon className="w-12 h-12 text-slate-700 mx-auto mb-3" />
            <p className="text-slate-400 font-medium">No generations found</p>
            <p className="text-sm text-slate-500 mt-1">Try adjusting your filters or start a new edit in the Editor.</p>
          </div>
        )}

        {!isLoading && jobs.length > 0 && (
          <div className="divide-y divide-white/[0.03]">
            {jobs.map((job, idx) => (
              <ArchiveRow
                key={job.id}
                job={job}
                index={idx}
                selected={selectedIds.has(job.id)}
                favorited={favoriteIds.has(job.id)}
                onSelect={(e) => toggleSelect(job.id, e.shiftKey)}
                onView={() => onSelectJob(job, idx)}
                onToggleFavorite={() => onToggleFavorite(job.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4 px-1">
          <p className="text-xs text-slate-500">
            Showing {page * limit + 1}–{Math.min((page + 1) * limit, total)} of {total}
          </p>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="px-3 py-1.5 rounded-md text-xs border border-white/10 text-slate-400 hover:text-white hover:border-white/20 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
            >
              Previous
            </button>
            {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
              let pageNum: number;
              if (totalPages <= 5) {
                pageNum = i;
              } else if (page < 3) {
                pageNum = i;
              } else if (page > totalPages - 4) {
                pageNum = totalPages - 5 + i;
              } else {
                pageNum = page - 2 + i;
              }
              return (
                <button
                  key={pageNum}
                  onClick={() => setPage(pageNum)}
                  className={`w-8 h-8 rounded-md text-xs transition-all ${
                    page === pageNum
                      ? "bg-amber-500/20 border border-amber-500/30 text-amber-400 font-medium"
                      : "border border-white/5 text-slate-400 hover:text-white hover:border-white/20"
                  }`}
                >
                  {pageNum + 1}
                </button>
              );
            })}
            <button
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
              className="px-3 py-1.5 rounded-md text-xs border border-white/10 text-slate-400 hover:text-white hover:border-white/20 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
            >
              Next
            </button>
          </div>
        </div>
      )}

      {/* Lookbook Pre-Generation Dialog */}
      <Dialog open={showLookbookDialog} onOpenChange={setShowLookbookDialog}>
        <DialogContent className="bg-[#0f1629] border-white/10 text-white max-w-md">
          <DialogHeader>
            <DialogTitle className="text-lg font-semibold text-white flex items-center gap-2">
              <FileText className="w-5 h-5 text-amber-400" />
              Generate Lookbook
            </DialogTitle>
            <DialogDescription className="text-slate-400 text-sm">
              Customize your branded PDF presentation before generating.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="lb-title" className="text-xs font-medium text-slate-300 uppercase tracking-wider">Title</Label>
              <Input
                id="lb-title"
                value={lookbookTitle}
                onChange={(e) => setLookbookTitle(e.target.value)}
                placeholder="Design Lookbook"
                className="bg-white/5 border-white/10 text-white placeholder:text-slate-500 focus:border-amber-500/50 focus:ring-amber-500/20"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="lb-subtitle" className="text-xs font-medium text-slate-300 uppercase tracking-wider">Subtitle</Label>
              <Input
                id="lb-subtitle"
                value={lookbookSubtitle}
                onChange={(e) => setLookbookSubtitle(e.target.value)}
                placeholder="Before & After Comparison"
                className="bg-white/5 border-white/10 text-white placeholder:text-slate-500 focus:border-amber-500/50 focus:ring-amber-500/20"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="lb-client" className="text-xs font-medium text-slate-300 uppercase tracking-wider">Client / Brand Name <span className="text-slate-500 normal-case">(optional)</span></Label>
              <Input
                id="lb-client"
                value={lookbookClient}
                onChange={(e) => setLookbookClient(e.target.value)}
                placeholder={tenant?.name || "e.g. Nike, Adidas, Under Armour"}
                className="bg-white/5 border-white/10 text-white placeholder:text-slate-500 focus:border-amber-500/50 focus:ring-amber-500/20"
              />
              <p className="text-xs text-slate-500">Appears on the cover page. Leave blank to use your org name.</p>
            </div>
          </div>
          <DialogFooter className="flex gap-2 sm:gap-2">
            <button
              onClick={() => setShowLookbookDialog(false)}
              className="px-4 py-2 rounded-lg text-sm text-slate-400 hover:text-white border border-white/10 hover:border-white/20 transition-all duration-200"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirmLookbook}
              className="px-4 py-2 rounded-lg text-sm font-medium bg-gradient-to-r from-amber-500 to-orange-500 text-[#0a0e1a] hover:from-amber-400 hover:to-orange-400 transition-all duration-200 active:scale-[0.97]"
            >
              Generate PDF
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ArchiveRow({
  job,
  index,
  selected,
  favorited,
  onSelect,
  onView,
  onToggleFavorite,
}: {
  job: Job;
  index: number;
  selected: boolean;
  favorited: boolean;
  onSelect: (e: React.MouseEvent) => void;
  onView: () => void;
  onToggleFavorite: () => void;
}) {
  const [imgHovered, setImgHovered] = useState(false);
  const type = getEditType(job.controls);
  const resultUrl = getResultUrl(job);
  const statusColors: Record<string, string> = {
    done: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
    failed: "bg-red-500/20 text-red-400 border-red-500/30",
    processing: "bg-blue-500/20 text-blue-400 border-blue-500/30 animate-pulse",
    pending: "bg-slate-500/20 text-slate-400 border-slate-500/30",
  };

  return (
    <div
      className={`group grid grid-cols-[40px_56px_1fr_100px_1.2fr_100px_80px_70px_80px_90px] gap-2 px-4 py-2.5 items-center hover:bg-white/[0.02] transition-all duration-150 cursor-pointer ${
        selected ? "bg-amber-500/[0.03]" : ""
      }`}
      style={{ animationDelay: `${index * 30}ms`, animation: "fadeIn 0.3s ease-out both" }}
      onClick={onView}
    >
      {/* Checkbox */}
      <div className="flex items-center" onClick={(e) => { e.stopPropagation(); onSelect(e); }}>
        <button className={`transition-colors ${selected ? "text-amber-400" : "text-slate-600 hover:text-slate-400"}`}>
          {selected ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
        </button>
      </div>

      {/* Preview thumbnail */}
      <div
        className="relative w-10 h-10 rounded-md overflow-hidden border border-white/10 group-hover:border-white/20 transition-all group-hover:shadow-md group-hover:shadow-black/20 group-hover:scale-110"
        onMouseEnter={() => setImgHovered(true)}
        onMouseLeave={() => setImgHovered(false)}
      >
        <img
          src={imgHovered && resultUrl ? resultUrl : job.originalUrl}
          alt={job.title}
          className="w-full h-full object-cover transition-all duration-200"
          loading="lazy"
        />
      </div>

      {/* Title */}
      <p className="text-sm text-white truncate font-medium">{job.title}</p>

      {/* Type */}
      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium border w-fit ${getTypeColor(type)}`}>
        {getTypeIcon(type)} {type}
      </span>

      {/* Changes */}
      <p className="text-xs text-slate-400 truncate">{describeChanges(job.controls)}</p>

      {/* Created by */}
      <div className="flex items-center gap-1.5">
        <div className="w-5 h-5 rounded-full bg-gradient-to-br from-amber-500/30 to-orange-500/30 flex items-center justify-center text-[9px] font-bold text-amber-300">
          {job.userName?.charAt(0)?.toUpperCase() || "?"}
        </div>
        <span className="text-xs text-slate-400 truncate">{job.userName}</span>
      </div>

      {/* Date */}
      <span className="text-xs text-slate-500">{relativeTime(job.createdAt)}</span>

      {/* Credits */}
      <span className="text-xs text-slate-400">{job.creditsUsed || "—"}</span>

      {/* Status */}
      <span className={`inline-flex px-2 py-0.5 rounded text-[10px] font-medium border w-fit ${statusColors[job.status] || statusColors.pending}`}>
        {job.status}
      </span>

      {/* Actions */}
      <div className="flex items-center gap-1 justify-end opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => e.stopPropagation()}>
        <button
          onClick={onToggleFavorite}
          className={`p-1.5 rounded transition-all duration-200 ${
            favorited ? "text-amber-400 hover:text-amber-300" : "text-slate-500 hover:text-white"
          }`}
          title="Favorite"
        >
          <Star className={`w-3.5 h-3.5 ${favorited ? "fill-amber-400" : ""}`} />
        </button>
        {resultUrl && (
          <a
            href={resultUrl}
            download
            className="p-1.5 rounded text-slate-500 hover:text-white transition-colors"
            title="Download"
          >
            <Download className="w-3.5 h-3.5" />
          </a>
        )}
        <button
          onClick={onView}
          className="p-1.5 rounded text-slate-500 hover:text-white transition-colors"
          title="View"
        >
          <Eye className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

// ─── Mobile Card List ───────────────────────────────────────────────────────

function MobileArchiveCard({
  job,
  favorited,
  onView,
  onToggleFavorite,
}: {
  job: Job;
  favorited: boolean;
  onView: () => void;
  onToggleFavorite: () => void;
}) {
  const type = getEditType(job.controls);
  const resultUrl = getResultUrl(job);
  const statusColors: Record<string, string> = {
    done: "bg-emerald-500/20 text-emerald-400",
    failed: "bg-red-500/20 text-red-400",
    processing: "bg-blue-500/20 text-blue-400",
    pending: "bg-slate-500/20 text-slate-400",
  };

  return (
    <div
      className="flex items-center gap-3 p-3 rounded-xl border border-white/5 hover:border-white/10 bg-white/[0.01] transition-all cursor-pointer active:scale-[0.98]"
      onClick={onView}
    >
      <div className="w-14 h-14 rounded-lg overflow-hidden border border-white/10 flex-shrink-0">
        <img src={resultUrl || job.originalUrl} alt={job.title} className="w-full h-full object-cover" loading="lazy" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-sm text-white font-medium truncate">{job.title}</p>
          <span className={`px-1.5 py-0.5 rounded text-[9px] font-medium ${getTypeColor(type)}`}>{type}</span>
        </div>
        <div className="flex items-center gap-2 mt-1">
          <span className="text-xs text-slate-500">{relativeTime(job.createdAt)}</span>
          <span className="text-xs text-slate-600">·</span>
          <span className="text-xs text-slate-500">{job.userName}</span>
          <span className={`ml-auto px-1.5 py-0.5 rounded text-[9px] ${statusColors[job.status]}`}>{job.status}</span>
        </div>
      </div>
      <button
        onClick={(e) => { e.stopPropagation(); onToggleFavorite(); }}
        className={`p-1.5 ${favorited ? "text-amber-400" : "text-slate-600"}`}
      >
        <Star className={`w-4 h-4 ${favorited ? "fill-amber-400" : ""}`} />
      </button>
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────

export default function StudioHistoryV2() {
  const [slideshowJobs, setSlideshowJobs] = useState<Job[] | null>(null);
  const [slideshowIndex, setSlideshowIndex] = useState(0);
  const { user } = useAuth();

  const { tenant } = useTenant();
  const { data: favData } = trpc.studio.favoriteIds.useQuery(
    { tenantId: tenant?.id ?? 0 },
    { enabled: !!tenant?.id }
  );
  const favoriteIds = useMemo(() => new Set(favData ?? []), [favData]);

  const utils = trpc.useUtils();
  const toggleFavMutation = trpc.studio.toggleFavorite.useMutation({
    onSuccess: () => {
      utils.studio.favoriteIds.invalidate();
      utils.studio.historyArchive.invalidate();
    },
  });

  const handleToggleFavorite = useCallback((jobId: number) => {
    if (!tenant?.id) return;
    toggleFavMutation.mutate({ tenantId: tenant.id, jobId });
  }, [toggleFavMutation, tenant?.id]);

  const openSlideshow = useCallback((job: Job, index: number, jobs?: Job[]) => {
    setSlideshowJobs(jobs || [job]);
    setSlideshowIndex(jobs ? index : 0);
  }, []);

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      {/* Page header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white tracking-tight">History</h1>
        <p className="text-sm text-slate-400 mt-1">Your recent generations and full archive.</p>
      </div>

      {/* Stats dashboard */}
      <StatsRow />

      {/* Recent strip */}
      <RecentStrip onSelect={(job, idx) => openSlideshow(job, idx)} />

      {/* Archive table (desktop) */}
      <div className="hidden md:block">
        <ArchiveTable
          onSelectJob={(job, idx) => openSlideshow(job, idx)}
          favoriteIds={favoriteIds}
          onToggleFavorite={handleToggleFavorite}
        />
      </div>

      {/* Mobile card list */}
      <div className="md:hidden">
        <MobileCardList
          favoriteIds={favoriteIds}
          onToggleFavorite={handleToggleFavorite}
          onView={(job) => openSlideshow(job, 0)}
        />
      </div>

      {/* Detail slideshow */}
      {slideshowJobs && (
        <DetailSlideshow
          jobs={slideshowJobs}
          initialIndex={slideshowIndex}
          onClose={() => setSlideshowJobs(null)}
          favoriteIds={favoriteIds}
          onToggleFavorite={handleToggleFavorite}
        />
      )}

      {/* Global CSS for animations */}
      <style>{`
        @keyframes fadeSlideUp {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        .scrollbar-hide::-webkit-scrollbar { display: none; }
      `}</style>
    </div>
  );
}

// ─── Mobile Card List (with search, filters, collapsible sections) ───────────

function MobileCardList({
  favoriteIds,
  onToggleFavorite,
  onView,
}: {
  favoriteIds: Set<number>;
  onToggleFavorite: (jobId: number) => void;
  onView: (job: Job) => void;
}) {
  const filters = useFilterParams();
  const { search, status, type: typeFilter, page, favorites: favoritesOnly, hasActiveFilters } = filters;
  const { setSearch: setSearchParam, setStatus: setStatusParam, setType: setTypeParam, setPage, setFavorites: setFavoritesOnly, clearAll } = filters;

  const [localSearch, setLocalSearch] = useState(search);
  const [debouncedSearch, setDebouncedSearch] = useState(search);
  const [showFilters, setShowFilters] = useState(false);
  const limit = 20;

  // Debounce local search → URL param + query
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(localSearch);
      setSearchParam(localSearch);
    }, 300);
    return () => clearTimeout(timer);
  }, [localSearch, setSearchParam]);

  // Sync URL search back to local input when navigating
  useEffect(() => { setLocalSearch(search); }, [search]);

  const { tenant } = useTenant();
  const { data, isLoading, isFetching } = trpc.studio.historyArchive.useQuery(
    {
      tenantId: tenant?.id ?? 0,
      limit,
      offset: page * limit,
      sortBy: "date",
      sortDir: "desc",
      status: status !== "all" ? status : undefined,
      search: debouncedSearch || undefined,
    },
    { enabled: !!tenant?.id }
  );

  const allJobs = data?.jobs ?? [];
  const jobs = useMemo(() => {
    let filtered = allJobs;
    if (favoritesOnly) {
      filtered = filtered.filter((j) => favoriteIds.has(j.id));
    }
    if (typeFilter !== "all") {
      filtered = filtered.filter((j) => getEditType(j.controls).toLowerCase() === typeFilter);
    }
    return filtered;
  }, [allJobs, typeFilter, favoritesOnly, favoriteIds]);
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / limit);

  return (
    <div>
      {/* Section header with filter toggle */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-medium text-slate-300 uppercase tracking-wider">Archive</h3>
          <span className="text-[10px] text-slate-500 bg-white/5 px-1.5 py-0.5 rounded-full">{total}</span>
          {isFetching && <Loader2 className="w-3 h-3 text-slate-500 animate-spin" />}
        </div>
        <button
          onClick={() => setShowFilters(!showFilters)}
          className={`p-2 rounded-lg border transition-all duration-200 ${showFilters || hasActiveFilters ? "border-amber-500/30 bg-amber-500/10 text-amber-400" : "border-white/10 text-slate-400"}`}
        >
          <Filter className="w-4 h-4" />
        </button>
      </div>

      {/* Collapsible filter bar */}
      {showFilters && (
        <div className="space-y-2 mb-4 p-3 rounded-xl border border-white/5 bg-white/[0.02] animate-in slide-in-from-top-2 duration-200">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <input
              type="text"
              value={localSearch}
              onChange={(e) => setLocalSearch(e.target.value)}
              placeholder="Search titles, elements..."
              className="w-full pl-9 pr-4 py-2.5 rounded-lg bg-white/[0.03] border border-white/10 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-amber-500/40 transition-all"
            />
          </div>
          {/* Status + Type filters */}
          <div className="flex gap-2">
            <select
              value={status}
              onChange={(e) => setStatusParam(e.target.value)}
              className="flex-1 px-3 py-2.5 rounded-lg bg-white/[0.03] border border-white/10 text-sm text-slate-300 focus:outline-none focus:border-amber-500/40 appearance-none"
            >
              <option value="all">All Status</option>
              <option value="done">Done</option>
              <option value="failed">Failed</option>
              <option value="processing">Processing</option>
              <option value="pending">Pending</option>
            </select>
            <select
              value={typeFilter}
              onChange={(e) => setTypeParam(e.target.value)}
              className="flex-1 px-3 py-2.5 rounded-lg bg-white/[0.03] border border-white/10 text-sm text-slate-300 focus:outline-none focus:border-amber-500/40 appearance-none"
            >
              <option value="all">All Types</option>
              <option value="density">Density</option>
              <option value="scale">Scale</option>
              <option value="recolor">Recolor</option>
              <option value="remove">Remove</option>
            </select>
          </div>
          {/* Favorites toggle */}
          <button
            onClick={() => setFavoritesOnly(!favoritesOnly)}
            className={`flex items-center gap-2 w-full px-3 py-2.5 rounded-lg border transition-all duration-200 ${
              favoritesOnly
                ? "border-amber-500/30 bg-amber-500/10 text-amber-400"
                : "border-white/10 bg-white/[0.03] text-slate-400"
            }`}
          >
            <Star className={`w-4 h-4 ${favoritesOnly ? "fill-amber-400" : ""}`} />
            <span className="text-sm font-medium">Favorites only</span>
            {favoritesOnly && (
              <span className="ml-auto text-[10px] bg-amber-500/20 px-1.5 py-0.5 rounded-full">
                {allJobs.filter((j) => favoriteIds.has(j.id)).length}
              </span>
            )}
          </button>
          {/* Clear filters */}
          {hasActiveFilters && (
            <button
              onClick={() => { clearAll(); }}
              className="text-xs text-amber-400 hover:text-amber-300 underline"
            >
              Clear all filters
            </button>
          )}
        </div>
      )}

      {/* Job list */}
      {isLoading ? (
        <div className="space-y-2">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-16 rounded-xl bg-white/[0.02] animate-pulse" />
          ))}
        </div>
      ) : jobs.length === 0 ? (
        <div className="py-12 text-center">
          <ImageIcon className="w-10 h-10 text-slate-700 mx-auto mb-2" />
          <p className="text-sm text-slate-400">No generations found</p>
          <p className="text-xs text-slate-500 mt-1">Try adjusting your filters.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {jobs.map((job) => (
            <MobileArchiveCard
              key={job.id}
              job={job}
              favorited={favoriteIds.has(job.id)}
              onView={() => onView(job)}
              onToggleFavorite={() => onToggleFavorite(job.id)}
            />
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <span className="text-[10px] text-slate-500">
            {page * limit + 1}–{Math.min((page + 1) * limit, total)} of {total}
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="px-3 py-1.5 rounded-lg text-xs border border-white/10 text-slate-400 disabled:opacity-30"
            >
              Prev
            </button>
            <button
              onClick={() => setPage((p) => p + 1)}
              disabled={(page + 1) * limit >= total}
              className="px-3 py-1.5 rounded-lg text-xs border border-white/10 text-slate-400 disabled:opacity-30"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
