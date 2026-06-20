/**
 * Replicate API client for SAM2 (Segment Anything Model 2).
 * Used by the hybrid Scale pipeline to segment individual motifs from garment images.
 *
 * Model: meta/sam-2 (Segment Anything v2 for Images)
 * Returns: combined mask + individual masks for each detected segment.
 */
import Replicate from "replicate";

/** Timeout for SAM2 prediction (model can take 20-60 seconds) */
const SAM2_TIMEOUT_MS = 90_000;

/** SAM2 model version on Replicate */
const SAM2_MODEL = "meta/sam-2" as const;

interface SAM2Input {
  /** Image URL (must be publicly accessible) */
  image: string;
  /** Points per side for automatic mask generation grid (higher = more masks, slower) */
  points_per_side?: number;
  /** Predicted IoU threshold for filtering low-quality masks */
  pred_iou_thresh?: number;
  /** Stability score threshold for filtering unstable masks */
  stability_score_thresh?: number;
  /** Use mask-to-mask refinement for better quality */
  use_m2m?: boolean;
}

export interface SAM2Mask {
  /** URL to the individual mask image (white = segment, black = background) */
  url: string;
  /** Bounding box [x, y, width, height] if available */
  bbox?: [number, number, number, number];
  /** Area of the mask in pixels */
  area?: number;
  /** Stability score (higher = more reliable) */
  stability_score?: number;
}

export interface SAM2Result {
  /** URL to the combined mask (all segments overlaid) */
  combinedMask: string;
  /** Array of individual mask URLs */
  individualMasks: string[];
}

/**
 * Get a configured Replicate client instance.
 * Reads REPLICATE_API_TOKEN from environment.
 */
function getReplicateClient(): Replicate {
  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) {
    throw new Error("REPLICATE_API_TOKEN is not configured. Add it in Settings → Secrets.");
  }
  return new Replicate({ auth: token });
}

/**
 * Run SAM2 automatic mask generation on an image.
 * Returns URLs to the combined mask and individual segment masks.
 *
 * @param imageUrl - Publicly accessible image URL
 * @param options - Optional SAM2 parameters for tuning segmentation quality
 */
export async function segmentWithSAM2(
  imageUrl: string,
  options?: {
    pointsPerSide?: number;
    predIouThresh?: number;
    stabilityScoreThresh?: number;
    useM2M?: boolean;
  }
): Promise<SAM2Result> {
  const replicate = getReplicateClient();

  const input: SAM2Input = {
    image: imageUrl,
    // Use fewer points for faster results on garment prints
    // (we want motif-level segments, not pixel-perfect edges)
    points_per_side: options?.pointsPerSide ?? 64,
    pred_iou_thresh: options?.predIouThresh ?? 0.86,
    stability_score_thresh: options?.stabilityScoreThresh ?? 0.92,
    use_m2m: options?.useM2M ?? true,
  };

  console.log(`[SAM2] Starting segmentation with points_per_side=${input.points_per_side}`);

  const output = await replicate.run(SAM2_MODEL, { input }) as any;

  // Parse the output — SAM2 returns { combined_mask: string, individual_masks: string[] }
  const combinedMask = output?.combined_mask || "";
  const individualMasks: string[] = Array.isArray(output?.individual_masks)
    ? output.individual_masks
    : [];

  console.log(`[SAM2] Segmentation complete: ${individualMasks.length} masks detected`);

  if (!combinedMask && individualMasks.length === 0) {
    throw new Error("SAM2 returned no masks. The image may not contain detectable motifs.");
  }

  return { combinedMask, individualMasks };
}

/**
 * Download a mask image from Replicate's CDN and return as a Buffer.
 */
export async function downloadMask(maskUrl: string): Promise<Buffer> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);

  try {
    const response = await fetch(maskUrl, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Failed to download mask: ${response.status}`);
    }
    return Buffer.from(await response.arrayBuffer());
  } finally {
    clearTimeout(timeout);
  }
}
