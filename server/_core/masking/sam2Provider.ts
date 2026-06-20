/**
 * SAM2 mask provider — the best-in-class tier (D1 = Option 2).
 *
 * getFabricMask: vision-LLM bbox (locateFabricRegion) -> SAM2 box-prompt -> raster.
 * getInstanceMasks: SAM2 automatic masks -> area-filtered InstanceMask[].
 * rasterReady is true (capability). The Replicate call lives behind the Sam2Client
 * seam; the default client throws MaskProviderUnavailableError until provisioned,
 * so STUDIO_MASK_PROVIDER=sam2 fails safe when unconfigured.
 *
 * `createSam2Provider(client)` injects a client (used in tests and for porting
 * Manus's verified Replicate client).
 */
import sharp from "sharp";
import type { FabricMask, InstanceMask, MaskImageInput, MaskProvider } from "./types";
import { decodeUpright } from "../image/decodeUpright";
import { locateFabricRegion } from "./locateFabricRegion";
import { decodeMaskToRaster, instancesFromMasks } from "./sam2Mask";
import { defaultSam2Client, type Sam2Client } from "./replicateSam2";

/** Re-encode the upright image as a PNG data URL for the hosted model. */
async function uprightDataUrl(url: string): Promise<{ dataUrl: string; width: number; height: number }> {
  const { buffer, width, height } = await decodeUpright(url);
  const png = await sharp(buffer, { raw: { width, height, channels: 4 } }).png().toBuffer();
  return { dataUrl: `data:image/png;base64,${png.toString("base64")}`, width, height };
}

export function createSam2Provider(client: Sam2Client): MaskProvider {
  return {
    name: "sam2",
    rasterReady: true,

    async getFabricMask(image: MaskImageInput): Promise<FabricMask> {
      const region = await locateFabricRegion(image.url);
      const { dataUrl, width, height } = await uprightDataUrl(image.url);
      const box: [number, number, number, number] = [
        Math.round(region.bbox.x * width),
        Math.round(region.bbox.y * height),
        Math.round((region.bbox.x + region.bbox.w) * width),
        Math.round((region.bbox.y + region.bbox.h) * height),
      ];
      const maskPng = await client.boxMask(dataUrl, box);
      const raster = await decodeMaskToRaster(maskPng, width, height);
      return { bbox: region.bbox, confidence: region.confidence, raster, provider: "sam2" };
    },

    async getInstanceMasks(image: MaskImageInput): Promise<InstanceMask[]> {
      const { dataUrl, width, height } = await uprightDataUrl(image.url);
      const masks = await client.autoMasks(dataUrl);
      return instancesFromMasks(masks, width, height);
    },
  };
}

export const sam2Provider: MaskProvider = createSam2Provider(defaultSam2Client());
