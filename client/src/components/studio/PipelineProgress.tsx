/**
 * PipelineProgress — real-time multi-stage progress bar with intermediate preview thumbnails.
 *
 * Displays labeled pipeline stages (segmenting → analyzing → processing → compositing → finalizing)
 * with animated transitions between stages. When the server emits preview thumbnails at key
 * stages, they appear in a filmstrip-style row showing the pipeline's visual progression.
 *
 * Works with both:
 * - SSE stream path: receives real `progress` events with stage + percent + optional previewUrl
 * - Async polling path: maps job status to approximate stages (no thumbnails available)
 */
import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { CheckCircle2, Circle, Loader2, Eye } from "lucide-react";

export type PipelineStage = "segmenting" | "analyzing" | "processing" | "compositing" | "finalizing";

interface StageConfig {
  id: PipelineStage;
  label: string;
  description: string;
}

const STAGES: StageConfig[] = [
  { id: "segmenting", label: "Segmenting", description: "Detecting print elements" },
  { id: "analyzing", label: "Analyzing", description: "Mapping motif instances" },
  { id: "processing", label: "Processing", description: "Applying adjustments" },
  { id: "compositing", label: "Compositing", description: "Rebuilding image" },
  { id: "finalizing", label: "Finalizing", description: "Saving result" },
];

interface PipelineProgressProps {
  /** Current pipeline stage from server progress events */
  currentStage: PipelineStage | null;
  /** Overall percent (0-100) from server progress events */
  percent: number;
  /** Elapsed seconds since processing started */
  elapsedSeconds: number;
  /** Whether we're using async polling (less granular stages) */
  isAsync?: boolean;
  /** Async job status for mapping to pipeline stages */
  asyncStatus?: string | null;
  /** Intermediate preview thumbnails keyed by stage name (base64 data URLs) */
  previewThumbnails?: Record<string, string>;
  /** Original image URL for the "before" reference */
  originalImageUrl?: string;
}

/** Map async job statuses to pipeline stages for the polling path */
function asyncStatusToStage(status: string | null | undefined): PipelineStage | null {
  switch (status) {
    case "pending":
      return "segmenting";
    case "sam2_processing":
      return "analyzing";
    case "cpu_processing":
      return "compositing";
    case "done":
      return "finalizing";
    default:
      return null;
  }
}

/** Map async job status to approximate percent */
function asyncStatusToPercent(status: string | null | undefined): number {
  switch (status) {
    case "pending":
      return 5;
    case "sam2_processing":
      return 30;
    case "cpu_processing":
      return 70;
    case "done":
      return 100;
    default:
      return 0;
  }
}

/** Preview thumbnail with zoom-on-hover */
function PreviewThumbnail({
  src,
  label,
  isLatest,
}: {
  src: string;
  label: string;
  isLatest: boolean;
}) {
  const [isZoomed, setIsZoomed] = useState(false);

  return (
    <div className="relative group">
      <button
        type="button"
        className={cn(
          "relative overflow-hidden rounded-lg border transition-all duration-300",
          "w-16 h-16 sm:w-20 sm:h-20",
          isLatest
            ? "border-primary/60 ring-2 ring-primary/20 shadow-lg shadow-primary/10"
            : "border-border/50 hover:border-primary/40",
          "animate-in fade-in zoom-in-95 duration-500"
        )}
        onClick={() => setIsZoomed(!isZoomed)}
        aria-label={`Preview: ${label}`}
      >
        <img
          src={src}
          alt={label}
          className="w-full h-full object-cover"
        />
        {/* Hover overlay */}
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors duration-200 flex items-center justify-center">
          <Eye className="w-4 h-4 text-white opacity-0 group-hover:opacity-100 transition-opacity duration-200" />
        </div>
        {/* Stage badge */}
        {isLatest && (
          <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent px-1 py-0.5">
            <span className="text-[9px] text-white font-medium truncate block text-center">
              {label}
            </span>
          </div>
        )}
      </button>

      {/* Zoomed preview modal */}
      {isZoomed && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm animate-in fade-in duration-200"
          onClick={() => setIsZoomed(false)}
        >
          <div className="relative max-w-sm max-h-[60vh] animate-in zoom-in-90 duration-300">
            <img
              src={src}
              alt={label}
              className="rounded-xl shadow-2xl max-w-full max-h-[60vh] object-contain"
            />
            <div className="absolute -bottom-8 left-0 right-0 text-center">
              <span className="text-sm text-white/80 font-medium">{label}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function PipelineProgress({
  currentStage,
  percent,
  elapsedSeconds,
  isAsync = false,
  asyncStatus,
  previewThumbnails = {},
  originalImageUrl,
}: PipelineProgressProps) {
  const effectiveStage = isAsync ? asyncStatusToStage(asyncStatus) : currentStage;
  const effectivePercent = isAsync ? asyncStatusToPercent(asyncStatus) : percent;

  const currentStageIndex = useMemo(() => {
    if (!effectiveStage) return -1;
    return STAGES.findIndex((s) => s.id === effectiveStage);
  }, [effectiveStage]);

  const formatTime = (s: number) => {
    const mins = Math.floor(s / 60);
    const secs = s % 60;
    return mins > 0 ? `${mins}:${secs.toString().padStart(2, "0")}` : `${secs}s`;
  };

  // Collect all available previews in pipeline order
  const orderedPreviews = useMemo(() => {
    const previews: Array<{ stage: string; label: string; src: string }> = [];
    // Add original image as "before" reference if available
    if (originalImageUrl) {
      previews.push({ stage: "original", label: "Original", src: originalImageUrl });
    }
    // Add stage previews in pipeline order
    for (const stage of STAGES) {
      if (previewThumbnails[stage.id]) {
        previews.push({ stage: stage.id, label: stage.label, src: previewThumbnails[stage.id] });
      }
    }
    return previews;
  }, [previewThumbnails, originalImageUrl]);

  const hasPreviews = orderedPreviews.length > 0;

  return (
    <div className="w-full space-y-4">
      {/* Preview thumbnails filmstrip */}
      {hasPreviews && (
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Eye className="w-3.5 h-3.5" />
            <span className="font-medium">Pipeline Preview</span>
          </div>
          <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-thin">
            {orderedPreviews.map((preview, idx) => (
              <div key={preview.stage} className="flex items-center gap-1.5">
                <PreviewThumbnail
                  src={preview.src}
                  label={preview.label}
                  isLatest={idx === orderedPreviews.length - 1 && preview.stage !== "original"}
                />
                {/* Arrow between thumbnails */}
                {idx < orderedPreviews.length - 1 && (
                  <svg
                    className="w-4 h-4 text-muted-foreground/40 flex-shrink-0"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M5 12h14M12 5l7 7-7 7" />
                  </svg>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Overall progress bar */}
      <div className="space-y-2">
        <div className="relative h-3 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-gradient-to-r from-primary via-primary/90 to-primary/70 transition-all duration-700 ease-out"
            style={{ width: `${Math.min(effectivePercent, 100)}%` }}
          />
          {/* Shimmer overlay for active state */}
          {effectivePercent < 100 && effectivePercent > 0 && (
            <div className="absolute inset-0 overflow-hidden rounded-full">
              <div className="animate-shimmer absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/20 to-transparent" />
            </div>
          )}
        </div>
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{formatTime(elapsedSeconds)} elapsed</span>
          <span className="font-medium text-foreground">{Math.round(effectivePercent)}%</span>
        </div>
      </div>

      {/* Pipeline stages */}
      <div className="flex items-center justify-between gap-1">
        {STAGES.map((stage, index) => {
          const isCompleted = index < currentStageIndex;
          const isCurrent = index === currentStageIndex;
          const isPending = index > currentStageIndex;
          const hasPreview = !!previewThumbnails[stage.id];

          return (
            <div
              key={stage.id}
              className={cn(
                "flex flex-col items-center gap-1.5 flex-1 min-w-0",
                "transition-all duration-300"
              )}
            >
              {/* Stage indicator */}
              <div className="relative">
                {isCompleted && (
                  <CheckCircle2 className={cn(
                    "w-5 h-5 text-primary animate-in fade-in duration-300",
                    hasPreview && "ring-2 ring-primary/20 rounded-full"
                  )} />
                )}
                {isCurrent && (
                  <Loader2 className="w-5 h-5 text-primary animate-spin" />
                )}
                {isPending && (
                  <Circle className="w-5 h-5 text-muted-foreground/40" />
                )}
              </div>

              {/* Stage label */}
              <span
                className={cn(
                  "text-[10px] sm:text-xs font-medium text-center leading-tight truncate w-full",
                  isCompleted && "text-primary",
                  isCurrent && "text-foreground",
                  isPending && "text-muted-foreground/50"
                )}
              >
                {stage.label}
              </span>
            </div>
          );
        })}
      </div>

      {/* Current stage description */}
      {effectiveStage && currentStageIndex >= 0 && (
        <p className="text-sm text-muted-foreground text-center animate-in fade-in slide-in-from-bottom-1 duration-300">
          {STAGES[currentStageIndex].description}...
        </p>
      )}
    </div>
  );
}
