/**
 * Hybrid Scale Pipeline for Print Studio.
 *
 * Instead of relying solely on AI to resize motifs (which doesn't work),
 * this pipeline uses a programmatic approach:
 *
 * 1. SAM2 segments the image into individual motif masks
 * 2. Sharp programmatically resizes each motif within its bounding box
 * 3. Background gaps are filled with the dominant background color
 * 4. (Optional) AI polish pass for seamless blending
 *
 * This guarantees visible, mathematically precise scaling that the AI model
 * cannot achieve on its own.
 */
import sharp, { OverlayOptions } from "sharp";
import { segmentWithSAM2, downloadMask } from "./replicateClient";
import { storageGetSignedUrl, storagePut } from "./storage";
import { fetchWithTimeout, TIMEOUT } from "./fetchTimeout";

/** Minimum mask area (in pixels) to be considered a motif vs noise */
const MIN_MOTIF_AREA_PX = 200;

/** Maximum number of masks to process (performance guard) */
const MAX_MASKS_TO_PROCESS = 80;

interface ScaleResult {
  /** URL to the final scaled image in storage */
  url: string;
  /** Number of motifs that were successfully scaled */
  motifsScaled: number;
  /** Total masks detected by SAM2 */
  totalMasksDetected: number;
}

/**
 * Execute the hybrid scale pipeline on a garment image.
 *
 * @param originalImageUrl - The /manus-storage/ URL or external URL of the original image
 * @param scalePercent - Negative = shrink (e.g., -50 means 50% smaller), positive = enlarge
 * @returns The storage URL of the scaled result
 */
export async function hybridScale(
  originalImageUrl: string,
  scalePercent: number
): Promise<ScaleResult> {
  console.log(`[HybridScale] Starting pipeline: scale=${scalePercent}%`);

  // 1. Resolve the image to a publicly accessible URL for SAM2
  let publicUrl: string;
  if (originalImageUrl.startsWith("/manus-storage/")) {
    const key = originalImageUrl.replace("/manus-storage/", "");
    publicUrl = await storageGetSignedUrl(key);
  } else {
    publicUrl = originalImageUrl;
  }

  // 2. Download the original image for local processing
  const originalBuffer = await downloadOriginalImage(publicUrl);
  const originalMeta = await sharp(originalBuffer).metadata();
  const imgWidth = originalMeta.width!;
  const imgHeight = originalMeta.height!;

  console.log(`[HybridScale] Image: ${imgWidth}x${imgHeight}`);

  // 3. Run SAM2 segmentation
  const sam2Result = await segmentWithSAM2(publicUrl, {
    // Use higher density for print patterns (lots of small motifs)
    pointsPerSide: 64,
    predIouThresh: 0.82,
    stabilityScoreThresh: 0.88,
    useM2M: true,
  });

  console.log(`[HybridScale] SAM2 returned ${sam2Result.individualMasks.length} masks`);

  if (sam2Result.individualMasks.length === 0) {
    throw new Error("SAM2 detected no motifs to scale. The image may not contain distinct print elements.");
  }

  // 4. Download and process individual masks
  const masksToProcess = sam2Result.individualMasks.slice(0, MAX_MASKS_TO_PROCESS);
  const maskBuffers = await downloadMasksParallel(masksToProcess);

  // 5. Detect the background color (most common color in non-motif areas)
  const bgColor = await detectBackgroundColor(originalBuffer, sam2Result.combinedMask);

  // 6. Apply scaling to each motif
  const scaleFactor = 1 + (scalePercent / 100); // -50% → 0.5, +30% → 1.3
  const scaledImage = await applyMotifScaling(
    originalBuffer,
    maskBuffers,
    scaleFactor,
    bgColor,
    imgWidth,
    imgHeight
  );

  // 7. Upload the result to storage
  const resultKey = `studio/scaled/${Date.now()}-scaled.png`;
  const { url } = await storagePut(resultKey, scaledImage, "image/png");

  console.log(`[HybridScale] Pipeline complete. Motifs scaled: ${maskBuffers.length}`);

  return {
    url,
    motifsScaled: maskBuffers.length,
    totalMasksDetected: sam2Result.individualMasks.length,
  };
}

/**
 * Download the original image with timeout and size validation.
 */
async function downloadOriginalImage(url: string): Promise<Buffer> {
  const response = await fetchWithTimeout(url, {}, TIMEOUT.IMAGE_DOWNLOAD);
  if (!response.ok) {
    throw new Error(`Failed to download original image: ${response.status}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > 10 * 1024 * 1024) {
    throw new Error("Image too large for hybrid scale pipeline (max 10MB)");
  }
  return buffer;
}

/**
 * Download multiple mask images in parallel with concurrency limit.
 */
async function downloadMasksParallel(maskUrls: string[]): Promise<Buffer[]> {
  const CONCURRENCY = 10;
  const results: Buffer[] = [];

  for (let i = 0; i < maskUrls.length; i += CONCURRENCY) {
    const batch = maskUrls.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.allSettled(
      batch.map(async (url) => {
        const response = await fetchWithTimeout(url, {}, 30_000);
        if (!response.ok) throw new Error(`Mask download failed: ${response.status}`);
        return Buffer.from(await response.arrayBuffer());
      })
    );

    for (const r of batchResults) {
      if (r.status === "fulfilled") {
        results.push(r.value);
      }
    }
  }

  return results;
}

/**
 * Detect the dominant background color by sampling non-motif areas.
 * Uses the combined mask to identify background regions.
 */
async function detectBackgroundColor(
  originalBuffer: Buffer,
  combinedMaskUrl: string
): Promise<{ r: number; g: number; b: number }> {
  try {
    // Download the combined mask
    const maskResponse = await fetchWithTimeout(combinedMaskUrl, {}, 30_000);
    if (!maskResponse.ok) {
      // Fallback: sample corners of the image
      return sampleCornersForBgColor(originalBuffer);
    }
    const maskBuffer = Buffer.from(await maskResponse.arrayBuffer());

    // Convert mask to grayscale single-channel
    const originalMeta = await sharp(originalBuffer).metadata();
    const w = originalMeta.width!;
    const h = originalMeta.height!;

    const maskGray = await sharp(maskBuffer)
      .resize(w, h, { fit: "fill" })
      .grayscale()
      .raw()
      .toBuffer();

    // Get raw pixels of original
    const originalRaw = await sharp(originalBuffer)
      .resize(w, h, { fit: "fill" })
      .removeAlpha()
      .raw()
      .toBuffer();

    // Sample pixels where mask is dark (background)
    let rSum = 0, gSum = 0, bSum = 0, count = 0;
    for (let i = 0; i < maskGray.length; i++) {
      // Mask value < 128 means background (not a motif)
      if (maskGray[i] < 128) {
        const px = i * 3;
        rSum += originalRaw[px];
        gSum += originalRaw[px + 1];
        bSum += originalRaw[px + 2];
        count++;
      }
    }

    if (count === 0) return sampleCornersForBgColor(originalBuffer);

    return {
      r: Math.round(rSum / count),
      g: Math.round(gSum / count),
      b: Math.round(bSum / count),
    };
  } catch (err) {
    console.warn("[HybridScale] Background color detection failed, using corner sampling:", err);
    return sampleCornersForBgColor(originalBuffer);
  }
}

/**
 * Fallback: sample the four corners of the image to estimate background color.
 */
async function sampleCornersForBgColor(
  imageBuffer: Buffer
): Promise<{ r: number; g: number; b: number }> {
  const meta = await sharp(imageBuffer).metadata();
  const w = meta.width!;
  const h = meta.height!;

  const raw = await sharp(imageBuffer).removeAlpha().raw().toBuffer();

  // Sample 10x10 pixel blocks from each corner
  const sampleSize = 10;
  const corners = [
    { x: 0, y: 0 },
    { x: w - sampleSize, y: 0 },
    { x: 0, y: h - sampleSize },
    { x: w - sampleSize, y: h - sampleSize },
  ];

  let rSum = 0, gSum = 0, bSum = 0, count = 0;
  for (const corner of corners) {
    for (let dy = 0; dy < sampleSize; dy++) {
      for (let dx = 0; dx < sampleSize; dx++) {
        const px = ((corner.y + dy) * w + (corner.x + dx)) * 3;
        if (px + 2 < raw.length) {
          rSum += raw[px];
          gSum += raw[px + 1];
          bSum += raw[px + 2];
          count++;
        }
      }
    }
  }

  return {
    r: Math.round(rSum / count),
    g: Math.round(gSum / count),
    b: Math.round(bSum / count),
  };
}

/**
 * Core scaling logic: for each mask, extract the motif, resize it,
 * and composite it back onto a background-filled canvas.
 */
async function applyMotifScaling(
  originalBuffer: Buffer,
  maskBuffers: Buffer[],
  scaleFactor: number,
  bgColor: { r: number; g: number; b: number },
  width: number,
  height: number
): Promise<Buffer> {
  console.log(`[HybridScale] Applying scale factor ${scaleFactor} to ${maskBuffers.length} motifs`);

  // Start with the original image
  // We'll create a "scaled" version by:
  // 1. For each mask, extract the bounding box region
  // 2. Resize the masked motif by scaleFactor
  // 3. Clear the original motif area (fill with bg color)
  // 4. Paste the resized motif centered at the same position

  // First, create a base canvas filled with background color where motifs were
  // We'll composite all scaled motifs onto it
  let result = sharp(originalBuffer).resize(width, height, { fit: "fill" });

  // Process each mask to find bounding boxes and extract motifs
  const compositeOps: OverlayOptions[] = [];

  for (let i = 0; i < maskBuffers.length; i++) {
    try {
      // Resize mask to match image dimensions
      const maskResized = await sharp(maskBuffers[i])
        .resize(width, height, { fit: "fill" })
        .grayscale()
        .raw()
        .toBuffer();

      // Find bounding box of this mask
      const bbox = findMaskBoundingBox(maskResized, width, height);
      if (!bbox || bbox.w < 5 || bbox.h < 5) continue; // Skip tiny masks

      // Check mask area
      const maskArea = countMaskPixels(maskResized, width, bbox);
      if (maskArea < MIN_MOTIF_AREA_PX) continue; // Skip noise

      // Extract the motif region from original image using the mask
      const motifExtract = await extractMaskedRegion(
        originalBuffer,
        maskBuffers[i],
        bbox,
        width,
        height
      );

      // Calculate new size
      const newW = Math.max(1, Math.round(bbox.w * scaleFactor));
      const newH = Math.max(1, Math.round(bbox.h * scaleFactor));

      // Resize the extracted motif
      const resizedMotif = await sharp(motifExtract)
        .resize(newW, newH, { fit: "fill" })
        .toBuffer();

      // Calculate position to center the resized motif at the original center
      const centerX = bbox.x + Math.round(bbox.w / 2);
      const centerY = bbox.y + Math.round(bbox.h / 2);
      const newLeft = Math.max(0, Math.min(width - newW, centerX - Math.round(newW / 2)));
      const newTop = Math.max(0, Math.min(height - newH, centerY - Math.round(newH / 2)));

      compositeOps.push({
        input: resizedMotif,
        left: newLeft,
        top: newTop,
      });
    } catch (err) {
      // Skip individual mask failures
      console.warn(`[HybridScale] Mask ${i} processing failed:`, err);
    }
  }

  if (compositeOps.length === 0) {
    throw new Error("No motifs could be processed for scaling. Try a different image.");
  }

  // Create the base: original image with motif areas filled with background
  // Then composite all resized motifs on top
  const bgFilled = await createBackgroundFilledBase(
    originalBuffer,
    maskBuffers,
    bgColor,
    width,
    height
  );

  // Composite all scaled motifs onto the background-filled base
  const finalImage = await sharp(bgFilled)
    .composite(compositeOps)
    .png()
    .toBuffer();

  console.log(`[HybridScale] Composited ${compositeOps.length} scaled motifs`);
  return finalImage;
}

/**
 * Find the bounding box of white pixels in a grayscale mask buffer.
 */
function findMaskBoundingBox(
  maskRaw: Buffer,
  width: number,
  height: number
): { x: number; y: number; w: number; h: number } | null {
  let minX = width, minY = height, maxX = 0, maxY = 0;
  let found = false;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (maskRaw[y * width + x] > 128) {
        found = true;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (!found) return null;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

/**
 * Count the number of white pixels in a mask within a bounding box.
 */
function countMaskPixels(
  maskRaw: Buffer,
  width: number,
  bbox: { x: number; y: number; w: number; h: number }
): number {
  let count = 0;
  for (let y = bbox.y; y < bbox.y + bbox.h; y++) {
    for (let x = bbox.x; x < bbox.x + bbox.w; x++) {
      if (maskRaw[y * width + x] > 128) count++;
    }
  }
  return count;
}

/**
 * Extract a masked region from the original image as a PNG with transparency.
 * Only pixels where the mask is white are kept; others become transparent.
 */
async function extractMaskedRegion(
  originalBuffer: Buffer,
  maskBuffer: Buffer,
  bbox: { x: number; y: number; w: number; h: number },
  imgWidth: number,
  imgHeight: number
): Promise<Buffer> {
  // Resize mask to image dimensions and extract the bbox region
  const maskResized = await sharp(maskBuffer)
    .resize(imgWidth, imgHeight, { fit: "fill" })
    .grayscale()
    .extract({ left: bbox.x, top: bbox.y, width: bbox.w, height: bbox.h })
    .toBuffer();

  // Extract the same region from the original image
  const originalRegion = await sharp(originalBuffer)
    .extract({ left: bbox.x, top: bbox.y, width: bbox.w, height: bbox.h })
    .ensureAlpha()
    .raw()
    .toBuffer();

  // Apply mask as alpha channel
  const maskRegionRaw = await sharp(maskResized).raw().toBuffer();
  const resultPixels = Buffer.alloc(bbox.w * bbox.h * 4);

  for (let i = 0; i < bbox.w * bbox.h; i++) {
    const srcIdx = i * 4;
    const maskVal = maskRegionRaw[i];

    resultPixels[srcIdx] = originalRegion[srcIdx];       // R
    resultPixels[srcIdx + 1] = originalRegion[srcIdx + 1]; // G
    resultPixels[srcIdx + 2] = originalRegion[srcIdx + 2]; // B
    resultPixels[srcIdx + 3] = maskVal > 128 ? originalRegion[srcIdx + 3] : 0; // A
  }

  return sharp(resultPixels, {
    raw: { width: bbox.w, height: bbox.h, channels: 4 },
  })
    .png()
    .toBuffer();
}

/**
 * Create a version of the original image where all motif areas are filled
 * with the background color. This serves as the base for compositing.
 */
async function createBackgroundFilledBase(
  originalBuffer: Buffer,
  maskBuffers: Buffer[],
  bgColor: { r: number; g: number; b: number },
  width: number,
  height: number
): Promise<Buffer> {
  // Get original as raw RGBA
  const originalRaw = await sharp(originalBuffer)
    .resize(width, height, { fit: "fill" })
    .ensureAlpha()
    .raw()
    .toBuffer();

  // Create a combined mask of all motifs
  const combinedMask = Buffer.alloc(width * height, 0);

  for (const maskBuf of maskBuffers) {
    try {
      const maskResized = await sharp(maskBuf)
        .resize(width, height, { fit: "fill" })
        .grayscale()
        .raw()
        .toBuffer();

      for (let i = 0; i < width * height; i++) {
        if (maskResized[i] > 128) {
          combinedMask[i] = 255;
        }
      }
    } catch {
      // Skip failed masks
    }
  }

  // Replace masked pixels with background color
  const resultPixels = Buffer.from(originalRaw);
  for (let i = 0; i < width * height; i++) {
    if (combinedMask[i] > 128) {
      const px = i * 4;
      resultPixels[px] = bgColor.r;
      resultPixels[px + 1] = bgColor.g;
      resultPixels[px + 2] = bgColor.b;
      resultPixels[px + 3] = 255;
    }
  }

  return sharp(resultPixels, {
    raw: { width, height, channels: 4 },
  })
    .png()
    .toBuffer();
}
