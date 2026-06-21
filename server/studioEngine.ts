/**
 * Studio Engine — shared generation logic extracted from the tRPC router.
 * Both the tRPC `generate` mutation and the SSE streaming endpoint import
 * `runVariation()` from here to avoid duplication.
 */
import { storagePut } from "./storage";
import {
  generateEditedImage,
  generateRecoloredImage,
  generateDensityImage,
  generateDensityRedistributeImage,
  generateScaledImage,
} from "./aiEngine";
import { ENV } from "./_core/env";
import { addVariation } from "./studioDb";
import { resolveTargetColorHex, type ControlSettings } from "../shared/controls";

/**
 * The single per-variation generator shared by `generate` and `rerun`.
 * `mode` selects the deterministic op (recolor/density/scale) vs the generative
 * prompt path. The density path returns no image on a degrade/no-op and THROWS
 * so the caller refunds — never billing for a count-based ask it could not meet.
 */
export async function runVariation(opts: {
  controls: ControlSettings;
  originalUrl: string;
  tenantId: number;
  jobId: number;
  instruction: string;
  expectation: string;
  round: number;
  mode: { recolor: boolean; density: boolean; scale: boolean };
  /** Aborted when the SSE client disconnects — checked before persisting so an
   *  abandoned (and refunded) job never delivers a free asset to history. */
  signal?: AbortSignal;
}): Promise<{ url: string; key: string }> {
  const { controls, originalUrl, tenantId, jobId, instruction, expectation, round, mode, signal } = opts;
  // C5: per-request audit context stamped on every outbound SAM2 call.
  const audit = { orgId: String(tenantId), jobId: String(jobId) };
  // If the caller aborted (client disconnect/timeout) while the work was running,
  // do NOT persist: the SSE handler has already refunded, so persisting would
  // hand the tenant a free, paid-for-then-refunded asset.
  const assertNotAborted = () => {
    if (signal?.aborted) throw new Error("aborted before persist");
  };

  if (mode.recolor) {
    const png = await generateRecoloredImage(originalUrl, {
      fromColor: controls.recolor.fromColor,
      toColor: resolveTargetColorHex(controls.recolor.targetColor),
      coverage: controls.recolor.coverage,
    }, audit);
    assertNotAborted();
    const key = `studio/${tenantId}/${jobId}/recolor-${round}.png`;
    const { url } = await storagePut(key, png, "image/png");
    await addVariation({ jobId, tenantId, resultKey: key, resultUrl: url, round });
    return { url, key };
  }

  if (mode.density) {
    const densityResult = ENV.studioDensityRedistribute
      ? await generateDensityRedistributeImage(originalUrl, controls.density.percent, audit)
      : await generateDensityImage(originalUrl, controls.density.percent, audit);
    if (!densityResult) {
      throw new Error("Density processing is temporarily unavailable. Please try again in a moment.");
    }
    assertNotAborted();
    const key = `studio/${tenantId}/${jobId}/density-${round}.png`;
    const { url } = await storagePut(key, densityResult.png, "image/png");
    await addVariation({ jobId, tenantId, resultKey: key, resultUrl: url, round });
    return { url, key };
  }

  if (mode.scale) {
    const png = await generateScaledImage(originalUrl, {
      targetFraction: (100 + controls.scale.percent) / 100,
    }, audit);
    assertNotAborted();
    const key = `studio/${tenantId}/${jobId}/scale-${round}.png`;
    const { url } = await storagePut(key, png, "image/png");
    await addVariation({ jobId, tenantId, resultKey: key, resultUrl: url, round });
    return { url, key };
  }

  // Generative (prompt) path
  const resultUrl = await generateEditedImage(originalUrl, instruction, "image/jpeg", expectation);
  assertNotAborted();
  await addVariation({
    jobId,
    tenantId,
    resultKey: resultUrl.replace("/manus-storage/", ""),
    resultUrl,
    round,
  });
  return { url: resultUrl, key: resultUrl.replace("/manus-storage/", "") };
}
