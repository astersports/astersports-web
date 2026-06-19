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

  // Skip small files (under 500KB) — not worth compressing
  if (file.size < 500 * 1024) return file;

  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(url);

      const { width, height } = img;

      // If already within bounds, skip compression
      if (width <= MAX_DIMENSION && height <= MAX_DIMENSION) {
        // Still re-encode as JPEG to reduce size if it's a PNG
        if (file.type === "image/jpeg" && file.size < 2 * 1024 * 1024) {
          resolve(file);
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
        resolve(file); // Fallback: return original
        return;
      }

      ctx.drawImage(img, 0, 0, newWidth, newHeight);

      // Export as JPEG
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            resolve(file);
            return;
          }

          // Create new file with original name but .jpg extension
          const compressedName = file.name.replace(/\.[^.]+$/, ".jpg");
          const compressed = new File([blob], compressedName, {
            type: "image/jpeg",
            lastModified: Date.now(),
          });

          console.log(
            `[imageCompress] ${file.name}: ${(file.size / 1024).toFixed(0)}KB → ${(compressed.size / 1024).toFixed(0)}KB (${newWidth}x${newHeight})`
          );

          resolve(compressed);
        },
        "image/jpeg",
        JPEG_QUALITY
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to load image for compression"));
    };

    img.src = url;
  });
}
