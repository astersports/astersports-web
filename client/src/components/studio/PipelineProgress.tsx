/**
 * PipelineProgress — real-time multi-stage progress bar for the generation pipeline.
 *
 * Displays labeled pipeline stages (segmenting → analyzing → processing → compositing → finalizing)
 * with animated transitions between stages. Works with both:
 * - SSE stream path: receives real `progress` events with stage + percent
 * - Async polling path: maps job status to approximate stages
 */
import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { CheckCircle2, Circle, Loader2 } from "lucide-react";

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

export default function PipelineProgress({
  currentStage,
  percent,
  elapsedSeconds,
  isAsync = false,
  asyncStatus,
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

  return (
    <div className="w-full space-y-4">
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
                  <CheckCircle2 className="w-5 h-5 text-primary animate-in fade-in duration-300" />
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
