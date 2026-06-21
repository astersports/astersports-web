/**
 * Studio Editor page — the main editing workflow:
 * 1. Upload garment image
 * 2. AI detects print elements
 * 3. Configure controls (Scale, Density, Remove)
 * 4. Generate → view before/after
 *
 * Density and Scale use SSE streaming: the frontend opens a long-lived POST
 * to /api/studio/generate-stream which keeps the serverless container alive
 * via heartbeats while SAM2 processes the image. On completion, the stream
 * sends a "done" event with results. Fallback: if the SSE endpoint rejects
 * (e.g. non-deterministic path), we use the tRPC mutation directly.
 */
import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { useTenant } from "@/contexts/TenantContext";
import ControlPanel from "@/components/studio/ControlPanel";
import BeforeAfter from "@/components/studio/BeforeAfter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Upload, Loader2, Sparkles, RefreshCw, AlertTriangle, Clock } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { compressImage } from "@/lib/imageCompress";
import type { ControlSettings } from "@shared/controls";
import { computeCredits } from "@shared/controls";
import { CREDIT_COST } from "@shared/billing";
import { shouldUseStream } from "@shared/controlHelpers";
import { useGenerateStream, type StreamCallbacks } from "@/hooks/useGenerateStream";

export default function StudioEditor() {
  const { tenant } = useTenant();

  const utils = trpc.useUtils();

  const [step, setStep] = useState<"upload" | "controls" | "processing" | "results">("upload");
  const [jobId, setJobId] = useState<number | null>(null);
  const [originalUrl, setOriginalUrl] = useState<string>("");
  const [detectedElements, setDetectedElements] = useState<string[]>([]);
  const [results, setResults] = useState<Array<{ url: string; key: string }>>([]);
  const [selectedResult, setSelectedResult] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [isDetecting, setIsDetecting] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingControls, setPendingControls] = useState<ControlSettings | null>(null);

  // Processing timer & progress state
  const [processingStartTime, setProcessingStartTime] = useState<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const uploadMutation = trpc.studio.upload.useMutation();
  const detectMutation = trpc.studio.detectElements.useMutation();
  const generateMutation = trpc.studio.generate.useMutation();

  const [uploadProgress, setUploadProgress] = useState("");

  // ─── SSE Stream callbacks ─────────────────────────────────────────────────
  const streamCallbacks = useMemo<StreamCallbacks>(() => ({
    onStarted: (data) => {
      setProcessingStartTime(Date.now());
      setElapsedSeconds(0);
      setStep("processing");
      toast.info("Processing started — this may take up to a minute.");
    },
    onHeartbeat: () => {
      // No-op — the heartbeat keeps the connection alive; the timer handles UI
    },
    onDone: (data) => {
      setIsGenerating(false);
      setResults(data.results);
      setSelectedResult(0);
      setStep("results");
      utils.tenants.myTenants.invalidate();

      if (data.lowBalance) {
        toast.warning(`Low balance: ${data.newBalance} credits remaining. Consider topping up.`);
      } else {
        toast.success(`Generation complete. ${data.creditsUsed} credits used.`);
      }
    },
    onError: (data) => {
      setIsGenerating(false);
      setStep("controls");
      utils.tenants.myTenants.invalidate();
      const msg = data.message || "Generation failed.";
      toast.error(data.refunded ? `${msg} Credits have been refunded.` : msg);
    },
  }), [utils]);

  const { startStream, abort: abortStream } = useGenerateStream(streamCallbacks);

  // Elapsed timer — ticks every second while processing
  useEffect(() => {
    if (step === "processing" && processingStartTime) {
      setElapsedSeconds(0);
      timerRef.current = setInterval(() => {
        setElapsedSeconds(Math.floor((Date.now() - processingStartTime) / 1000));
      }, 1000);
      return () => {
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
      };
    }
    // Reset when leaving processing
    if (step !== "processing" && timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, [step, processingStartTime]);

  const handleFileSelect = useCallback(
    async (file: File) => {
      if (!tenant) return;
      setIsUploading(true);

      try {
        // Step 1: Compress image client-side
        setUploadProgress("Compressing image...");
        const compressed = await compressImage(file);

        // Step 2: Convert to base64
        setUploadProgress("Preparing upload...");
        const buffer = await compressed.arrayBuffer();
        const base64 = btoa(
          new Uint8Array(buffer).reduce((data, byte) => data + String.fromCharCode(byte), "")
        );

        // Step 3: Upload to server
        setUploadProgress("Uploading to server...");
        const job = await uploadMutation.mutateAsync({
          tenantId: tenant.id,
          fileName: compressed.name,
          fileBase64: base64,
          mimeType: compressed.type || "image/jpeg",
          title: file.name.replace(/\.[^.]+$/, ""),
        });

        setJobId(job.id);
        setOriginalUrl(job.originalUrl);

        // Step 4: Auto-detect elements
        setIsDetecting(true);
        setUploadProgress("Analyzing print elements...");
        const { elements } = await detectMutation.mutateAsync({ tenantId: tenant.id, jobId: job.id });
        setDetectedElements(elements);
        setStep("controls");

        toast.success(`Image uploaded — detected ${elements.length} print elements.`);
      } catch (error: any) {
        toast.error(error.message || "Upload failed. Please try again.");
      } finally {
        setIsUploading(false);
        setIsDetecting(false);
        setUploadProgress("");
      }
    },
    [tenant, uploadMutation, detectMutation]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file && file.type.startsWith("image/")) handleFileSelect(file);
    },
    [handleFileSelect]
  );

  // Fetch trial status to gate generation
  const { data: trialStatus } = trpc.studio.trialStatus.useQuery(
    { tenantId: tenant?.id ?? 0 },
    { enabled: !!tenant }
  );

  // Show confirmation dialog before generating
  const requestGenerate = useCallback(
    (controls: ControlSettings) => {
      // Block generation if trial expired
      if (trialStatus?.inTrial && (trialStatus.expired || trialStatus.daysRemaining === 0)) {
        toast.error("Your free trial has ended. Please choose a plan to continue generating.");
        return;
      }
      setPendingControls(controls);
      setConfirmOpen(true);
    },
    [trialStatus]
  );

  const handleConfirmGenerate = useCallback(async () => {
    if (!pendingControls || !jobId || !tenant) return;
    setConfirmOpen(false);
    const controls = pendingControls;
    setPendingControls(null);
    setIsGenerating(true);

    // Determine if this should use the SSE streaming path
    const useStream = shouldUseStream(controls);

    if (useStream) {
      // ─── SSE STREAMING PATH (density/scale) ─────────────────────────────
      // Opens a long-lived connection that keeps the container alive.
      startStream({
        tenantId: tenant.id,
        jobId,
        controls,
      });
    } else {
      // ─── TRPC MUTATION PATH (recolor/remove/prompt — fast) ──────────────
      try {
        const result = await generateMutation.mutateAsync({
          tenantId: tenant.id,
          jobId,
          controls,
        });

        if (result.async) {
          // Shouldn't happen for non-density/scale, but handle gracefully
          // by falling back to SSE stream
          startStream({
            tenantId: tenant.id,
            jobId,
            controls,
          });
        } else {
          // Sync result — show immediately
          setResults(result.results);
          setSelectedResult(0);
          setStep("results");
          utils.tenants.myTenants.invalidate();
          setIsGenerating(false);

          if (result.lowBalance) {
            toast.warning(`Low balance: ${result.newBalance} credits remaining. Consider topping up.`);
          } else {
            toast.success(`${result.results.length} variation(s) generated. ${result.creditsUsed} credits used.`);
          }
        }
      } catch (error: any) {
        setIsGenerating(false);
        toast.error(error.message || "Generation failed. Please try again.");
      }
    }
  }, [pendingControls, jobId, tenant, generateMutation, utils, startStream]);

  const handleRegenerate = () => {
    setStep("controls");
    setResults([]);
  };

  const handleNewUpload = () => {
    abortStream(); // Cancel any in-flight stream
    setStep("upload");
    setJobId(null);
    setOriginalUrl("");
    setDetectedElements([]);
    setResults([]);
  };

  const handleDownload = (url: string) => {
    window.open(url, "_blank");
  };

  // ─── Upload step ───────────────────────────────────────────────────────────
  if (step === "upload") {
    return (
      <div className="max-w-2xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Print Studio Editor</h1>
          <p className="text-muted-foreground mt-1">
            Upload a garment photo to adjust scale, density, or remove elements from the print.
          </p>
        </div>

        <Card>
          <CardContent className="p-0">
            <label
              className="flex flex-col items-center justify-center gap-4 p-12 border-2 border-dashed border-border rounded-lg cursor-pointer hover:border-primary/50 hover:bg-accent/50 transition-colors"
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDrop}
            >
              {isUploading || isDetecting ? (
                <>
                  <Loader2 className="w-12 h-12 text-primary animate-spin" />
                  <p className="text-sm text-muted-foreground">{uploadProgress}</p>
                </>
              ) : (
                <>
                  <Upload className="w-12 h-12 text-muted-foreground" />
                  <div className="text-center">
                    <p className="text-sm font-medium">
                      Drop an image here or click to browse
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      JPEG, PNG, or WebP — max 16 MB
                    </p>
                  </div>
                </>
              )}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleFileSelect(file);
                }}
                disabled={isUploading || isDetecting}
              />
            </label>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ─── Confirmation cost (must be computed before any early returns that use it) ──
  const confirmCreditCost = pendingControls ? computeCredits(pendingControls, CREDIT_COST) : 0;

  // ─── Processing step (SSE stream in progress) ──────────────────────────────
  if (step === "processing") {
    // Estimated duration: 50s typical. Progress uses an ease-out curve
    // so it moves fast at first and slows near the end (never reaches 100% until done).
    const ESTIMATED_DURATION = 50;
    const rawProgress = Math.min(elapsedSeconds / ESTIMATED_DURATION, 0.95);
    // Ease-out curve: fast start, slow finish
    const easedProgress = 1 - Math.pow(1 - rawProgress, 2.5);
    const progressPercent = Math.round(easedProgress * 95); // cap at 95% until done

    const formatTime = (s: number) => {
      const mins = Math.floor(s / 60);
      const secs = s % 60;
      return mins > 0 ? `${mins}:${secs.toString().padStart(2, "0")}` : `${secs}s`;
    };

    const statusMessage = elapsedSeconds < 10
      ? "Segmenting print elements..."
      : elapsedSeconds < 25
      ? "Analyzing motif instances..."
      : elapsedSeconds < 40
      ? "Processing density adjustments..."
      : "Finalizing result...";

    return (
      <div className="max-w-2xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Processing</h1>
          <p className="text-muted-foreground mt-1">
            Your image is being processed. This typically takes 30–60 seconds.
          </p>
        </div>

        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-6 py-12">
            <div className="relative">
              <Loader2 className="w-14 h-14 text-primary animate-spin" />
              <Sparkles className="w-5 h-5 text-primary/60 absolute -top-1 -right-1 animate-pulse" />
            </div>

            <div className="text-center space-y-1">
              <p className="text-lg font-medium">Generating your result...</p>
              <p className="text-sm text-muted-foreground">{statusMessage}</p>
            </div>

            {/* Progress bar */}
            <div className="w-full max-w-sm space-y-2">
              <Progress value={progressPercent} className="h-2.5" />
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {formatTime(elapsedSeconds)} elapsed
                </span>
                <span>~{formatTime(Math.max(0, ESTIMATED_DURATION - elapsedSeconds))} remaining</span>
              </div>
            </div>

            {originalUrl && (
              <div className="mt-2 w-full max-w-xs">
                <img
                  src={originalUrl}
                  alt="Original"
                  className="w-full rounded-lg object-contain max-h-40 opacity-50"
                />
                <p className="text-xs text-center text-muted-foreground mt-2">Original image</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  // ─── Controls step ─────────────────────────────────────────────────────────
  if (step === "controls") {
    return (
      <>
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Generation</AlertDialogTitle>
            <AlertDialogDescription>
              This will use <span className="font-bold text-foreground">{confirmCreditCost} credit{confirmCreditCost !== 1 ? "s" : ""}</span> from your balance
              (currently {tenant?.creditBalance.toLocaleString() ?? 0} credits). This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmGenerate}>
              <Sparkles className="w-4 h-4 mr-1.5" />
              Generate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold">Adjust Print</h1>
            <p className="text-muted-foreground text-sm mt-1">
              Configure controls below, then generate.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={handleNewUpload}>
            New Upload
          </Button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Preview */}
          <Card className="overflow-hidden">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Original Image
              </CardTitle>
            </CardHeader>
            <CardContent>
              <img
                src={originalUrl}
                alt="Original garment"
                className="w-full rounded-lg object-contain max-h-[500px]"
              />
              {detectedElements.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {detectedElements.map((el) => (
                    <span
                      key={el}
                      className="rounded-full bg-secondary px-2.5 py-1 text-xs font-medium text-secondary-foreground"
                    >
                      {el}
                    </span>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Controls */}
          <div>
            <ControlPanel
              detectedElements={detectedElements}
              onGenerate={requestGenerate}
              isGenerating={isGenerating}
              creditBalance={tenant?.creditBalance ?? 0}
            />
          </div>
        </div>
      </div>
      </>
    );
  }

  // ─── Results step ──────────────────────────────────────────────────────────
  return (
    <>
    <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Confirm Generation</AlertDialogTitle>
          <AlertDialogDescription>
            This will use <span className="font-bold text-foreground">{confirmCreditCost} credit{confirmCreditCost !== 1 ? "s" : ""}</span> from your balance
            (currently {tenant?.creditBalance.toLocaleString() ?? 0} credits). This action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={handleConfirmGenerate}>
            <Sparkles className="w-4 h-4 mr-1.5" />
            Generate
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    <div className="max-w-full lg:max-w-5xl mx-auto overflow-hidden">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Results</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Compare before and after, then download or regenerate.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleRegenerate}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            Adjust & Regenerate
          </Button>
          <Button variant="outline" size="sm" onClick={handleNewUpload}>
            New Upload
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Variation selector */}
        {results.length > 1 && (
          <div className="lg:col-span-3 flex gap-2">
            {results.map((r, i) => (
              <button
                key={i}
                onClick={() => setSelectedResult(i)}
                className={`rounded-lg border-2 overflow-hidden transition-all ${
                  selectedResult === i
                    ? "border-primary ring-2 ring-primary/20"
                    : "border-border hover:border-primary/50"
                }`}
              >
                <img
                  src={r.url}
                  alt={`Variation ${i + 1}`}
                  className="w-20 h-20 object-cover"
                />
              </button>
            ))}
          </div>
        )}

        {/* Before/After */}
        <div className="lg:col-span-3">
          {results[selectedResult] && (
            <BeforeAfter
              beforeUrl={originalUrl}
              afterUrl={results[selectedResult].url}
              onDownload={() => handleDownload(results[selectedResult].url)}
            />
          )}
        </div>
      </div>
    </div>
    </>
  );
}
