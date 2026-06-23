/**
 * Studio Engine — shared generation logic extracted from the tRPC router.
 * Both the tRPC `generate` mutation and the SSE streaming endpoint import
 * `runVariation()` from here to avoid duplication.
 */
import { storagePut } from "./storage";
import {
  generateEditedImage,
  generateDensityImage,
  generateDensityRedistributeImage,
  generateScaledImage,
} from "./aiEngine";
import { ENV } from "./_core/env";
import { addVariation } from "./studioDb";
import { type ControlSettings } from "../shared/controls";
import { thumbnailFromPng } from "./previewThumbnail";

/**
 * The single per-variation generator shared by `generate` and `rerun`.
 * `mode` selects the deterministic op (density/scale) vs the generative prompt
 * fallback. The density path returns no image on a degrade/no-op and THROWS so
 * the caller refunds — never billing for a count-based ask it could not meet.
 */
/** Pipeline stage identifiers for real-time progress reporting. */
export type PipelineStage = "segmenting" | "analyzing" | "processing" | "compositing" | "finalizing";

export async function runVariation(opts: {
  controls: ControlSettings;
  originalUrl: string;
  tenantId: number;
  jobId: number;
  instruction: string;
  expectation: string;
  round: number;
  mode: { density: boolean; scale: boolean };
  /** Aborted when the SSE client disconnects — checked before persisting so an
   *  abandoned (and refunded) job never delivers a free asset to history. */
  signal?: AbortSignal;
  /** Optional callback to report pipeline progress to the SSE stream.
   *  previewUrl is an optional base64 data URL of a small thumbnail. */
  onProgress?: (stage: PipelineStage, percent: number, previewUrl?: string) => void;
}): Promise<{ url: string; key: string }> {
  const { controls, originalUrl, tenantId, jobId, instruction, expectation, round, mode, signal, onProgress } = opts;
  const progress: (stage: PipelineStage, percent: number, previewUrl?: string) => void = onProgress ?? (() => {});
  // C5: per-request audit context stamped on every outbound SAM2 call.
  const audit = { orgId: String(tenantId), jobId: String(jobId) };
  // If the caller aborted (client disconnect/timeout) while the work was running,
  // do NOT persist: the SSE handler has already refunded, so persisting would
  // hand the tenant a free, paid-for-then-refunded asset.
  const assertNotAborted = () => {
    if (signal?.aborted) throw new Error("aborted before persist");
  };

  if (mode.density) {
    progress("segmenting", 10);
    const densityResult = ENV.studioDensityRedistribute
      ? await generateDensityRedistributeImage(originalUrl, controls.density.percent, audit)
      : await generateDensityImage(originalUrl, controls.density.percent, audit);
    if (!densityResult) {
      throw new Error("Density processing is temporarily unavailable. Please try again in a moment.");
    }
    // Generate a preview thumbnail of the composited result
    const densityPreview = await thumbnailFromPng(densityResult.png);
    progress("compositing", 80, densityPreview);
    assertNotAborted();
    progress("finalizing", 90);
    const key = `studio/${tenantId}/${jobId}/density-${round}.png`;
    const { url } = await storagePut(key, densityResult.png, "image/png");
    await addVariation({ jobId, tenantId, resultKey: key, resultUrl: url, round });
    progress("finalizing", 100);
    return { url, key };
  }

  if (mode.scale) {
    progress("segmenting", 10);
    const png = await generateScaledImage(originalUrl, {
      targetFraction: (100 + controls.scale.percent) / 100,
    }, audit);
    // Generate a preview thumbnail of the scaled result
    const scalePreview = await thumbnailFromPng(png);
    progress("compositing", 80, scalePreview);
    assertNotAborted();
    progress("finalizing", 90);
    const key = `studio/${tenantId}/${jobId}/scale-${round}.png`;
    const { url } = await storagePut(key, png, "image/png");
    await addVariation({ jobId, tenantId, resultKey: key, resultUrl: url, round });
    progress("finalizing", 100);
    return { url, key };
  }

  // Generative (prompt) path
  progress("processing", 20);
  const resultUrl = await generateEditedImage(originalUrl, instruction, "image/jpeg", expectation);
  progress("finalizing", 90);
  assertNotAborted();
  await addVariation({
    jobId,
    tenantId,
    resultKey: resultUrl.replace("/manus-storage/", ""),
    resultUrl,
    round,
  });
  progress("finalizing", 100);
  return { url: resultUrl, key: resultUrl.replace("/manus-storage/", "") };
}
