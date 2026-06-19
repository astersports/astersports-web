/**
 * Client-side image compression utility.
 * Resizes large images before upload to reduce transfer time and server processing.
 * Target: max 2048px on longest side, JPEG quality 0.85 — balances quality vs speed.
 */

const MAX_DIMENSION = 2048;
const JPEG_QUALITY = 0.85;

/**
 * Compress an image file client-side.
 * Returns a new File with reduced dimensions and JPEG compression.
 * If the image is already small enough, returns it unchanged.
 */
export async function compressImage(file: File): Promise<File> {
  // Skip non-image files
  if (!file.type.startsWith("image/")) return file;

  // Reject oversized input before decoding, so a huge file cannot hang the tab.
  const MAX_INPUT_BYTES = 16 * 1024 * 1024;
  if (file.size > MAX_INPUT_BYTES) {
    throw new Error(
      `Image too large: ${(file.size / 1024 / 1024).toFixed(1)}MB exceeds the 16MB limit.`
    );
  }

  // Skip small files (under 500KB) — not worth compressing
  if (file.size < 500 * 1024) return file;

  // Prefer createImageBitmap with explicit orientation; fall back to Image().
  let bitmap: ImageBitmap | null = null;
  try {
    if (typeof createImageBitmap === "function") {
      bitmap = await createImageBitmap(file, { imageOrientation: "from-image" } as any);
    }
  } catch {
    bitmap = null;
  }

  // Determine source dimensions
  const srcWidth = bitmap ? bitmap.width : 0;
  const srcHeight = bitmap ? bitmap.height : 0;

  // If bitmap is not available, fall back to Image() decode
  if (!bitmap) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);

      img.onload = () => {
        URL.revokeObjectURL(url);
        drawAndExport(img, img.width, img.height, file, resolve);
      };

      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("Failed to load image for compression"));
      };

      img.src = url;
    });
  }

  // Bitmap path — EXIF orientation already applied
  return new Promise((resolve) => {
    drawAndExport(bitmap!, srcWidth, srcHeight, file, resolve);
  });
}

/** Shared draw-to-canvas + export logic used by both bitmap and Image paths. */
function drawAndExport(
  source: ImageBitmap | HTMLImageElement,
  width: number,
  height: number,
  originalFile: File,
  resolve: (file: File) => void
) {
  // If already within bounds, skip compression for small JPEGs
  if (width <= MAX_DIMENSION && height <= MAX_DIMENSION) {
    if (originalFile.type === "image/jpeg" && originalFile.size < 2 * 1024 * 1024) {
      resolve(originalFile);
      return;
    }
  }

  // Calculate new dimensions maintaining aspect ratio
  let newWidth = width;
  let newHeight = height;
  if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
    if (width > height) {
      newWidth = MAX_DIMENSION;
      newHeight = Math.round(height * (MAX_DIMENSION / width));
    } else {
      newHeight = MAX_DIMENSION;
      newWidth = Math.round(width * (MAX_DIMENSION / height));
    }
  }

  // Draw to canvas
  const canvas = document.createElement("canvas");
  canvas.width = newWidth;
  canvas.height = newHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    resolve(originalFile);
    return;
  }

  ctx.drawImage(source, 0, 0, newWidth, newHeight);

  // Export as JPEG
  canvas.toBlob(
    (blob) => {
      if (!blob) {
        resolve(originalFile);
        return;
      }

      const compressedName = originalFile.name.replace(/\.[^.]+$/, ".jpg");
      const compressed = new File([blob], compressedName, {
        type: "image/jpeg",
        lastModified: Date.now(),
      });

      console.log(
        `[imageCompress] ${originalFile.name}: ${(originalFile.size / 1024).toFixed(0)}KB → ${(compressed.size / 1024).toFixed(0)}KB (${newWidth}x${newHeight})`
      );

      resolve(compressed);
    },
    "image/jpeg",
    JPEG_QUALITY
  );
}
