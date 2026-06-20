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
import type { FabricMask, InstanceMask, MaskImageInput, MaskProvider, BBoxNormalized } from "./types";
import { decodeUpright } from "../image/decodeUpright";
import { locateFabricRegion } from "./locateFabricRegion";
import { decodeMaskToRaster, instancesFromMasks } from "./sam2Mask";
import { defaultSam2Client, type Sam2Client } from "./replicateSam2";

/** Context passed to the provider for audit logging (Requirement 2). */
export interface Sam2AuditContext {
  orgId?: string;
  jobId?: string;
}

/** Module-level audit context — set by the caller before invoking the provider. */
let _auditCtx: Sam2AuditContext = {};

/** Set the audit context before calling SAM2 provider methods. */
export function setSam2AuditContext(ctx: Sam2AuditContext): void {
  _auditCtx = { ...ctx };
}

/** Clear the audit context after the call completes. */
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
  const cropWidth = Math.min(width - left, Math.round(bbox.w * width));
  const cropHeight = Math.min(height - top, Math.round(bbox.h * height));

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
function logSam2Call(operation: string, cropWidth: number, cropHeight: number): void {
  const orgId = _auditCtx.orgId ?? "unknown";
  const jobId = _auditCtx.jobId ?? "unknown";
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
 *  `known` to skip the vision-LLM locate (e.g. getInstanceMasks with a fabric hint). */
async function cropAndSegment(
  client: Sam2Client,
  image: MaskImageInput,
  known?: BBoxNormalized
): Promise<CropSegment> {
  let bbox: BBoxNormalized;
  let confidence: number;
  if (known) {
    bbox = known;
    confidence = 1;
  } else {
    const region = await locateFabricRegion(image.url); // vision LLM bbox; no data leaves
    bbox = region.bbox;
    confidence = region.confidence;
  }
  const { buffer, width, height } = await decodeUpright(image.url); // local only
  const { dataUrl, cropWidth, cropHeight } = await cropToFabricRegion(buffer, width, height, bbox); // Req 1
  logSam2Call("autoSegment", cropWidth, cropHeight); // Req 2
  const seg = await client.autoSegment(dataUrl);
  return { bbox, confidence, width, height, cropWidth, cropHeight, seg };
}

/** Provisional fabric raster = combined_mask, remapped to full image (rule pinned
 *  in the locked prompt; boxMask whole-crop is the reserve fallback in the client). */
async function fabricFromSegment(s: CropSegment): Promise<FabricMask> {
  const cropRaster =
    s.seg.combined.length > 0
      ? (await decodeMaskToRaster(s.seg.combined, s.cropWidth, s.cropHeight)).data
      : new Uint8Array(s.cropWidth * s.cropHeight);
  const fullRaster = remapRasterToFullImage(cropRaster, s.cropWidth, s.cropHeight, s.width, s.height, s.bbox);
  return { bbox: s.bbox, confidence: s.confidence, raster: { width: s.width, height: s.height, data: fullRaster }, provider: "sam2" };
}

/** Instance masks from individual_masks, area-filtered, remapped to full image. */
async function instancesFromSegment(s: CropSegment): Promise<InstanceMask[]> {
  const instances = await instancesFromMasks(s.seg.individuals, s.cropWidth, s.cropHeight);
  return instances.map((inst) => ({
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

    /** SINGLE SAM2 call -> fabric + instances (density's single-call path). */
    async getSegmentation(image: MaskImageInput): Promise<{ fabric: FabricMask; instances: InstanceMask[] }> {
      const s = await cropAndSegment(client, image);
      const [fabric, instances] = await Promise.all([fabricFromSegment(s), instancesFromSegment(s)]);
      return { fabric, instances };
    },
  };
}

export const sam2Provider: MaskProvider = createSam2Provider(defaultSam2Client());
