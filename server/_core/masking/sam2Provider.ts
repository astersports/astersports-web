/**
 * SAM2 mask provider — the best-in-class tier (D1 = Option 2).
 *
 * Privacy gate (docs/sam2-privacy-gate.md):
 *  - Requirement 1: CROP-TO-FABRIC MINIMIZATION — only the fabric bbox crop is
 *    sent to Replicate, never the full customer image.
 *  - Requirement 2: ORG_ID LOGGING — every outbound SAM2 call is logged with
 *    tenant/org context for audit trail.
 *
 * One auto-segmentation call per crop returns both halves (Architect ruling,
 * pre-prompt reconciliation): fabric raster <- combined_mask, instances <-
 * individual_masks. The degenerate box-prompt is dropped (it was never exercised
 * on meta/sam-2). The exact fabric-selection rule over combined_mask
 * (interior-restricted vs largest-connected-component) is PINNED + fabric-IoU
 * validated in the locked scale/density prompt; this provider uses combined_mask
 * directly as the provisional fabric raster.
 *
 * getFabricMask: vision-LLM bbox (locateFabricRegion) -> crop -> SAM2 auto -> combined_mask raster.
 * getInstanceMasks: crop -> SAM2 auto -> individual_masks -> area-filtered InstanceMask[].
 * rasterReady is true (capability). The Replicate call lives behind the Sam2Client
 * seam; the default client throws MaskProviderUnavailableError until provisioned,
 * so STUDIO_MASK_PROVIDER=sam2 fails safe when unconfigured.
 *
 * `createSam2Provider(client)` injects a client (used in tests and for porting
 * Manus's verified Replicate client).
 */
import sharp from "sharp";
import type { FabricMask, InstanceMask, MaskImageInput, MaskProvider, BBoxNormalized, Sam2AuditContext } from "./types";
import { decodeUpright } from "../image/decodeUpright";
import { locateFabricRegion, locateFabricRegionForDensity } from "./locateFabricRegion";
import { decodeMaskToRaster, instancesFromMasks } from "./sam2Mask";
import { defaultSam2Client, type Sam2Client } from "./replicateSam2";
import { ENV } from "../env";
import type { PredictionMeta } from "../../../drizzle/schema";

export type { Sam2AuditContext } from "./types";

/**
 * C5: Deprecated module-level audit context, retained ONLY as a fallback for
 * legacy call sites and tests. Production callers pass audit context per-request
 * via `MaskImageInput.audit` (race-free). Do NOT rely on this for new code.
 */
let _auditCtx: Sam2AuditContext = {};

/** @deprecated Pass audit context via `MaskImageInput.audit` instead. */
export function setSam2AuditContext(ctx: Sam2AuditContext): void {
  _auditCtx = { ...ctx };
}

/** @deprecated Pass audit context via `MaskImageInput.audit` instead. */
export function clearSam2AuditContext(): void {
  _auditCtx = {};
}

/**
 * Requirement 1: Crop the upright image to the fabric bbox region.
 * Only this cropped region is sent to Replicate — never the full image.
 * Returns the cropped PNG as a data URL plus the crop dimensions.
 */
async function cropToFabricRegion(
  buffer: Buffer,
  width: number,
  height: number,
  bbox: BBoxNormalized
): Promise<{ dataUrl: string; cropWidth: number; cropHeight: number }> {
  const left = Math.max(0, Math.round(bbox.x * width));
  const top = Math.max(0, Math.round(bbox.y * height));
  // Math.max(1, …): a tiny/odd bbox can round to 0, and sharp .extract() throws
  // "bad extract area" on a zero-dimension crop (hard-failing the job).
  const cropWidth = Math.max(1, Math.min(width - left, Math.round(bbox.w * width)));
  const cropHeight = Math.max(1, Math.min(height - top, Math.round(bbox.h * height)));

  const cropped = await sharp(buffer, { raw: { width, height, channels: 4 } })
    .extract({ left, top, width: cropWidth, height: cropHeight })
    .png()
    .toBuffer();

  return {
    dataUrl: `data:image/png;base64,${cropped.toString("base64")}`,
    cropWidth,
    cropHeight,
  };
}

/**
 * Requirement 2: Log every outbound SAM2 call with org context.
 */
function logSam2Call(operation: string, cropWidth: number, cropHeight: number, audit?: Sam2AuditContext): void {
  const orgId = audit?.orgId ?? _auditCtx.orgId ?? "unknown";
  const jobId = audit?.jobId ?? _auditCtx.jobId ?? "unknown";
  console.log(
    `[sam2-privacy] outbound SAM2 call: op=${operation} org_id=${orgId} job_id=${jobId} ` +
      `crop_dimensions=${cropWidth}x${cropHeight} timestamp=${new Date().toISOString()}`
  );
}

/**
 * Map a mask produced from a cropped region back to full-image coordinates.
 */
function remapRasterToFullImage(
  cropRaster: Uint8Array,
  cropWidth: number,
  cropHeight: number,
  fullWidth: number,
  fullHeight: number,
  bbox: BBoxNormalized
): Uint8Array {
  const fullRaster = new Uint8Array(fullWidth * fullHeight);
  const left = Math.max(0, Math.round(bbox.x * fullWidth));
  const top = Math.max(0, Math.round(bbox.y * fullHeight));

  for (let cy = 0; cy < cropHeight && (top + cy) < fullHeight; cy++) {
    for (let cx = 0; cx < cropWidth && (left + cx) < fullWidth; cx++) {
      fullRaster[(top + cy) * fullWidth + (left + cx)] = cropRaster[cy * cropWidth + cx];
    }
  }
  return fullRaster;
}

/** Result of one locate + crop + autoSegment call (the single-call primitive). */
interface CropSegment {
  bbox: BBoxNormalized;
  confidence: number;
  width: number;
  height: number;
  cropWidth: number;
  cropHeight: number;
  seg: { combined: Buffer; individuals: Buffer[] };
}

/** locate (or reuse) fabric region -> crop -> ONE autoSegment call. The shared
 *  primitive so density gets fabric + instances from a SINGLE SAM2 call. Pass
 *  `known` to skip the vision-LLM locate (e.g. getInstanceMasks with a fabric hint).
 *  `forDensity` selects the density-specific locator (full-garment coverage). */
async function locateAndCrop(
  image: MaskImageInput,
  known?: BBoxNormalized,
  forDensity?: boolean
): Promise<{ bbox: BBoxNormalized; confidence: number; width: number; height: number; cropWidth: number; cropHeight: number; dataUrl: string }> {
  let bbox: BBoxNormalized;
  let confidence: number;
  if (known) {
    bbox = known;
    confidence = 1;
  } else {
    // SAFEGUARD 1: density uses its own locator with stricter full-garment prompt
    const region = forDensity
      ? await locateFabricRegionForDensity(image.url)
      : await locateFabricRegion(image.url);
    bbox = region.bbox;
    confidence = region.confidence;
  }
  const { buffer, width, height } = await decodeUpright(image.url); // local only
  const { dataUrl, cropWidth, cropHeight } = await cropToFabricRegion(buffer, width, height, bbox); // Req 1
  return { bbox, confidence, width, height, cropWidth, cropHeight, dataUrl };
}

async function cropAndSegment(
  client: Sam2Client,
  image: MaskImageInput,
  known?: BBoxNormalized,
  forDensity?: boolean
): Promise<CropSegment> {
  const c = await locateAndCrop(image, known, forDensity);
  logSam2Call("autoSegment", c.cropWidth, c.cropHeight, image.audit); // Req 2 (C5: per-request audit)
  const seg = await client.autoSegment(c.dataUrl);
  return { bbox: c.bbox, confidence: c.confidence, width: c.width, height: c.height, cropWidth: c.cropWidth, cropHeight: c.cropHeight, seg };
}

/**
 * Fabric raster = FULL CROP REGION (bbox-fill). The locateFabricRegion vision-LLM
 * already identified the fabric area; everything inside that bbox IS fabric.
 *
 * Previous approach used combined_mask, but for dense print patterns SAM2's
 * combined_mask is sparse (only the motif union) — leaving almost no bare ground
 * for densityThin's base-cloth sampling. Using the full crop as fabric ensures
 * adequate bare-ground pixels between motifs.
 *
 * DUAL MASK (Option B): Also extracts the SAM2 combined mask as `boundaryRaster`.
 * This is the actual garment silhouette used by densityRedistribute for:
 *   - Layout constraints (blueNoiseLayout only places motifs on garment)
 *   - Compositing clip (no motif pixels bleed onto background)
 * The primary `raster` (full-crop fill) remains the sampling mask for base-cloth
 * color extraction (v1 densityThin compatibility).
 */
async function fabricFromSegment(s: CropSegment): Promise<FabricMask> {
  // Fill the entire crop region as "fabric" (all pixels = 255) — sampling mask
  const cropRaster = new Uint8Array(s.cropWidth * s.cropHeight).fill(255);
  const fullRaster = remapRasterToFullImage(cropRaster, s.cropWidth, s.cropHeight, s.width, s.height, s.bbox);

  // Decode the SAM2 combined mask (garment silhouette) as boundary mask
  const combinedRaster = await decodeMaskToRaster(s.seg.combined, s.cropWidth, s.cropHeight);
  const fullBoundary = remapRasterToFullImage(combinedRaster.data, s.cropWidth, s.cropHeight, s.width, s.height, s.bbox);

  return {
    bbox: s.bbox,
    confidence: s.confidence,
    raster: { width: s.width, height: s.height, data: fullRaster },
    boundaryRaster: { width: s.width, height: s.height, data: fullBoundary },
    provider: "sam2",
  };
}

/**
 * Instance masks from individual_masks, area-filtered, remapped to full image.
 *
 * Giant-instance filter: any segment whose pixel area exceeds MAX_INSTANCE_FRACTION
 * of the crop is treated as "background/ground" (not a motif) and excluded. SAM2
 * auto-segmentation on dense prints often detects the ground itself as one large
 * segment — including it would leave zero bare-ground for base-cloth sampling.
 */
const MAX_INSTANCE_FRACTION = 0.20; // 20% of crop area

async function instancesFromSegment(s: CropSegment): Promise<InstanceMask[]> {
  const instances = await instancesFromMasks(s.seg.individuals, s.cropWidth, s.cropHeight);
  const cropArea = s.cropWidth * s.cropHeight;
  const maxPx = cropArea * MAX_INSTANCE_FRACTION;

  // Filter: exclude instances larger than 20% of the crop (those are ground, not
  // motifs), keeping each survivor's pixel area for the cap below.
  const kept: Array<{ inst: InstanceMask; px: number }> = [];
  for (const inst of instances) {
    if (!inst.raster) { kept.push({ inst, px: 0 }); continue; }
    let px = 0;
    for (let i = 0; i < inst.raster.data.length; i++) {
      if (inst.raster.data[i] > 127) px++;
    }
    if (px > maxPx) {
      console.log(`[sam2] Filtering out giant instance (${px}px > ${Math.round(maxPx)}px max) — likely ground, not motif`);
      continue;
    }
    kept.push({ inst, px });
  }

  // Memory/latency cap: each instance is remapped to a FULL-image raster below, so
  // a pathological SAM2 over-segmentation is an OOM vector. Density only needs a
  // representative set, so keep the K largest motifs (deterministic: area desc,
  // index tiebreak). No-op when within the cap.
  kept.sort((a, b) => (b.px - a.px) || (instances.indexOf(a.inst) - instances.indexOf(b.inst)));
  const capped = kept.length > ENV.studioMaxInstances ? kept.slice(0, ENV.studioMaxInstances) : kept;
  if (capped.length < kept.length) {
    console.log(`[sam2] Capped instances ${kept.length} -> ${capped.length} (STUDIO_MAX_INSTANCES) to bound memory`);
  }
  const filtered = capped.map((k) => k.inst);

  return filtered.map((inst) => ({
    bbox: {
      x: s.bbox.x + inst.bbox.x * s.bbox.w,
      y: s.bbox.y + inst.bbox.y * s.bbox.h,
      w: inst.bbox.w * s.bbox.w,
      h: inst.bbox.h * s.bbox.h,
    },
    raster: inst.raster
      ? { width: s.width, height: s.height, data: remapRasterToFullImage(inst.raster.data, s.cropWidth, s.cropHeight, s.width, s.height, s.bbox) }
      : undefined,
  }));
}

/**
 * Async seam (ASYNC_GENERATION_SPEC §2-§3): rebuild { fabric, instances } from a completed
 * prediction's mask buffers + the crop geometry persisted at enqueue (studio_jobs.predictionMeta)
 * — the same construction getSegmentation does synchronously, minus the vision-LLM locate (which
 * already ran at enqueue). Used by the async worker; the sync getSegmentation is unchanged.
 */
export async function finishSam2Segmentation(
  segmentation: { combined: Buffer; individuals: Buffer[] },
  meta: PredictionMeta
): Promise<{ fabric: FabricMask; instances: InstanceMask[] }> {
  const s: CropSegment = {
    bbox: meta.bbox,
    confidence: 1,
    width: meta.width,
    height: meta.height,
    cropWidth: meta.cropWidth,
    cropHeight: meta.cropHeight,
    seg: segmentation,
  };
  const [fabric, instances] = await Promise.all([fabricFromSegment(s), instancesFromSegment(s)]);
  return { fabric, instances };
}

/**
 * Async enqueue seam (ASYNC_GENERATION_SPEC §4): the synchronous-at-enqueue work — locate (vision-
 * LLM) + crop — then START the SAM2 prediction WITHOUT waiting (predictions.create returns at once).
 * Returns the predictionId + crop geometry (PredictionMeta) to persist on the job, so the worker
 * finishes later via finishSam2Segmentation WITHOUT re-running the locate. forDensity (default true)
 * uses the full-garment density locator. Crop-to-fabric minimization (Req 1) + org audit (Req 2)
 * are preserved — only the fabric crop is sent to Replicate.
 */
export async function startSam2Segmentation(
  image: MaskImageInput,
  opts?: { client?: Sam2Client; webhookUrl?: string; forDensity?: boolean }
): Promise<{ predictionId: string; meta: PredictionMeta }> {
  const client = opts?.client ?? defaultSam2Client();
  const c = await locateAndCrop(image, undefined, opts?.forDensity ?? true);
  logSam2Call("startPrediction", c.cropWidth, c.cropHeight, image.audit);
  const predictionId = await client.startPrediction(c.dataUrl, undefined, opts?.webhookUrl);
  return { predictionId, meta: { bbox: c.bbox, width: c.width, height: c.height, cropWidth: c.cropWidth, cropHeight: c.cropHeight } };
}

export function createSam2Provider(client: Sam2Client): MaskProvider {
  return {
    name: "sam2",
    rasterReady: true,

    async getFabricMask(image: MaskImageInput): Promise<FabricMask> {
      return fabricFromSegment(await cropAndSegment(client, image));
    },

    async getInstanceMasks(image: MaskImageInput, fabric?: FabricMask): Promise<InstanceMask[]> {
      return instancesFromSegment(await cropAndSegment(client, image, fabric?.bbox));
    },

    /** SINGLE SAM2 call -> fabric + instances (density's single-call path).
     *  Uses the density-specific locator (forDensity=true) for full-garment coverage. */
    async getSegmentation(image: MaskImageInput): Promise<{ fabric: FabricMask; instances: InstanceMask[] }> {
      const s = await cropAndSegment(client, image, undefined, true); // forDensity=true
      const [fabric, instances] = await Promise.all([fabricFromSegment(s), instancesFromSegment(s)]);
      return { fabric, instances };
    },
  };
}

export const sam2Provider: MaskProvider = createSam2Provider(defaultSam2Client());
