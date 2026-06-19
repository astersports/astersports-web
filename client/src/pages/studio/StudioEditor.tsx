/**
 * Studio Editor page — the main editing workflow:
 * 1. Upload garment image
 * 2. AI detects print elements
 * 3. Configure controls (Scale, Density, Remove)
 * 4. Generate → view before/after
 */
import { useState, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { useTenant } from "@/contexts/TenantContext";
import ControlPanel from "@/components/studio/ControlPanel";
import BeforeAfter from "@/components/studio/BeforeAfter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Upload, Loader2, Sparkles, RefreshCw, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import type { ControlSettings } from "@shared/controls";

export default function StudioEditor() {
  const { tenant } = useTenant();

  const utils = trpc.useUtils();

  const [step, setStep] = useState<"upload" | "controls" | "results">("upload");
  const [jobId, setJobId] = useState<number | null>(null);
  const [originalUrl, setOriginalUrl] = useState<string>("");
  const [detectedElements, setDetectedElements] = useState<string[]>([]);
  const [results, setResults] = useState<Array<{ url: string; key: string }>>([]);
  const [selectedResult, setSelectedResult] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [isDetecting, setIsDetecting] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);

  const uploadMutation = trpc.studio.upload.useMutation();
  const detectMutation = trpc.studio.detectElements.useMutation();
  const generateMutation = trpc.studio.generate.useMutation();

  const handleFileSelect = useCallback(
    async (file: File) => {
      if (!tenant) return;
      setIsUploading(true);

      try {
        // Convert to base64
        const buffer = await file.arrayBuffer();
        const base64 = btoa(
          new Uint8Array(buffer).reduce((data, byte) => data + String.fromCharCode(byte), "")
        );

        // Upload
        const job = await uploadMutation.mutateAsync({
          tenantId: tenant.id,
          fileName: file.name,
          fileBase64: base64,
          mimeType: file.type || "image/jpeg",
          title: file.name.replace(/\.[^.]+$/, ""),
        });

        setJobId(job.id);
        setOriginalUrl(job.originalUrl);

        // Auto-detect elements
        setIsDetecting(true);
        const { elements } = await detectMutation.mutateAsync({ tenantId: tenant.id, jobId: job.id });
        setDetectedElements(elements);
        setStep("controls");

        toast.success(`Image uploaded — detected ${elements.length} print elements.`);
      } catch (error: any) {
        toast.error(error.message || "Upload failed. Please try again.");
      } finally {
        setIsUploading(false);
        setIsDetecting(false);
      }
    },
    [tenant, uploadMutation, detectMutation, toast]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file && file.type.startsWith("image/")) handleFileSelect(file);
    },
    [handleFileSelect]
  );

  const handleGenerate = useCallback(
    async (controls: ControlSettings) => {
      if (!jobId || !tenant) return;
      setIsGenerating(true);

      try {
        const result = await generateMutation.mutateAsync({
          tenantId: tenant.id,
          jobId,
          controls,
        });

        setResults(result.results);
        setSelectedResult(0);
        setStep("results");
        utils.tenants.myTenants.invalidate();

        if (result.lowBalance) {
          toast.warning(`Low balance: ${result.newBalance} credits remaining. Consider topping up.`);
        } else {
          toast.success(`${result.results.length} variation(s) generated. ${result.creditsUsed} credits used.`);
        }
      } catch (error: any) {
        toast.error(error.message || "Generation failed. Please try again.");
      } finally {
        setIsGenerating(false);
      }
    },
    [jobId, tenant, generateMutation, utils, toast]
  );

  const handleRegenerate = () => {
    setStep("controls");
    setResults([]);
  };

  const handleNewUpload = () => {
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
                  <Loader2 className="w-10 h-10 text-primary animate-spin" />
                  <p className="text-sm text-muted-foreground">
                    {isDetecting ? "Detecting print elements..." : "Uploading..."}
                  </p>
                </>
              ) : (
                <>
                  <Upload className="w-10 h-10 text-muted-foreground" />
                  <div className="text-center">
                    <p className="text-sm font-medium">Drop a garment image here</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      or click to browse — JPEG, PNG, WebP up to 16MB
                    </p>
                  </div>
                </>
              )}
              <input
                type="file"
                accept="image/*"
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

  // ─── Controls step ─────────────────────────────────────────────────────────
  if (step === "controls") {
    return (
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
              onGenerate={handleGenerate}
              isGenerating={isGenerating}
              creditBalance={tenant?.creditBalance ?? 0}
            />
          </div>
        </div>
      </div>
    );
  }

  // ─── Results step ──────────────────────────────────────────────────────────
  return (
    <div className="max-w-5xl mx-auto">
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
  );
}
