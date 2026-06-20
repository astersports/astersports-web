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

export function createSam2Provider(client: Sam2Client): MaskProvider {
  return {
    name: "sam2",
    rasterReady: true,

    async getFabricMask(image: MaskImageInput): Promise<FabricMask> {
      // Step 1: Get the fabric region bbox via vision LLM (no data leaves)
      const region = await locateFabricRegion(image.url);

      // Step 2: Decode the full image upright (local only)
      const { buffer, width, height } = await decodeUpright(image.url);

      // Step 3: PRIVACY — crop to fabric region only (Requirement 1)
      const { dataUrl: croppedDataUrl, cropWidth, cropHeight } = await cropToFabricRegion(
        buffer, width, height, region.bbox
      );

      // Step 4: AUDIT — log the outbound call (Requirement 2)
      logSam2Call("autoSegment", cropWidth, cropHeight);

      // Step 5: Send ONLY the cropped region to Replicate (one auto call)
      const seg = await client.autoSegment(croppedDataUrl);

      // Step 6: Provisional fabric raster = combined_mask (selection rule pinned in
      // the locked prompt). Remap from crop coordinates back to the full image.
      const cropRaster =
        seg.combined.length > 0
          ? (await decodeMaskToRaster(seg.combined, cropWidth, cropHeight)).data
          : new Uint8Array(cropWidth * cropHeight);
      const fullRaster = remapRasterToFullImage(
        cropRaster, cropWidth, cropHeight, width, height, region.bbox
      );

      return {
        bbox: region.bbox,
        confidence: region.confidence,
        raster: { width, height, data: fullRaster },
        provider: "sam2",
      };
    },

    async getInstanceMasks(image: MaskImageInput, fabric?: FabricMask): Promise<InstanceMask[]> {
      // Step 1: Get or reuse the fabric region
      const region = fabric?.bbox ?? (await locateFabricRegion(image.url)).bbox;

      // Step 2: Decode the full image upright (local only)
      const { buffer, width, height } = await decodeUpright(image.url);

      // Step 3: PRIVACY — crop to fabric region only (Requirement 1)
      const { dataUrl: croppedDataUrl, cropWidth, cropHeight } = await cropToFabricRegion(
        buffer, width, height, region
      );

      // Step 4: AUDIT — log the outbound call (Requirement 2)
      logSam2Call("autoSegment", cropWidth, cropHeight);

      // Step 5: Send ONLY the cropped region to Replicate (one auto call)
      const seg = await client.autoSegment(croppedDataUrl);

      // Step 6: Process individual masks — crop coordinates, remap to full image
      const instances = await instancesFromMasks(seg.individuals, cropWidth, cropHeight);

      // Remap each instance bbox from crop-relative to full-image-relative (normalized)
      return instances.map((inst) => ({
        bbox: {
          x: region.x + inst.bbox.x * region.w,
          y: region.y + inst.bbox.y * region.h,
          w: inst.bbox.w * region.w,
          h: inst.bbox.h * region.h,
        },
        raster: inst.raster
          ? {
              width,
              height,
              data: remapRasterToFullImage(
                inst.raster.data, cropWidth, cropHeight, width, height, region
              ),
            }
          : undefined,
      }));
    },
  };
}

export const sam2Provider: MaskProvider = createSam2Provider(defaultSam2Client());
