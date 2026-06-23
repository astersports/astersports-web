/**
 * Preview Thumbnail Generator
 *
 * Creates small base64-encoded data URLs from image buffers for SSE progress events.
 * Thumbnails are kept small (~200px wide) to avoid bloating the SSE stream while
 * still providing meaningful visual feedback during the pipeline.
 */
import sharp from "sharp";

const THUMB_MAX_WIDTH = 200;
const THUMB_QUALITY = 60; // JPEG quality — balance between size and clarity

/**
 * Generate a small JPEG thumbnail data URL from a PNG buffer.
 * Returns undefined if generation fails (non-blocking — progress continues without preview).
 */
export async function thumbnailFromPng(pngBuffer: Buffer): Promise<string | undefined> {
  try {
    const jpeg = await sharp(pngBuffer)
      .resize({ width: THUMB_MAX_WIDTH, withoutEnlargement: true })
      .jpeg({ quality: THUMB_QUALITY })
      .toBuffer();
    return `data:image/jpeg;base64,${jpeg.toString("base64")}`;
  } catch (e) {
    console.warn("[previewThumbnail] Failed to generate thumbnail from PNG:", e);
    return undefined;
  }
}

/**
 * Generate a small JPEG thumbnail data URL from a raw RGBA buffer.
 * Used for intermediate compositing results that haven't been encoded to PNG yet.
 */
export async function thumbnailFromRaw(
  data: Buffer | Uint8Array,
  width: number,
  height: number
): Promise<string | undefined> {
  try {
    const jpeg = await sharp(Buffer.from(data), {
      raw: { width, height, channels: 4 },
    })
      .resize({ width: THUMB_MAX_WIDTH, withoutEnlargement: true })
      .jpeg({ quality: THUMB_QUALITY })
      .toBuffer();
    return `data:image/jpeg;base64,${jpeg.toString("base64")}`;
  } catch (e) {
    console.warn("[previewThumbnail] Failed to generate thumbnail from raw:", e);
    return undefined;
  }
}

/**
 * Generate a thumbnail from a URL (fetches and resizes).
 * Used for the original image preview at the start of the pipeline.
 */
export async function thumbnailFromUrl(imageUrl: string): Promise<string | undefined> {
  try {
    const response = await fetch(imageUrl);
    if (!response.ok) return undefined;
    const buffer = Buffer.from(await response.arrayBuffer());
    const jpeg = await sharp(buffer)
      .resize({ width: THUMB_MAX_WIDTH, withoutEnlargement: true })
      .jpeg({ quality: THUMB_QUALITY })
      .toBuffer();
    return `data:image/jpeg;base64,${jpeg.toString("base64")}`;
  } catch (e) {
    console.warn("[previewThumbnail] Failed to generate thumbnail from URL:", e);
    return undefined;
  }
}
