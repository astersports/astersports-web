/**
 * Upscale DPI Guard (Decision 2, STUDIO_OPS_SPEC.md § 2.7)
 *
 * On enlarge (f > 1), effective output DPI = source DPI / f.
 * - When source DPI metadata is present: enforce effective DPI >= 150 (reject pre-deduct).
 * - When source DPI metadata is absent: degrade to warn-only (the basis is unknown).
 *
 * Also provides a scale-down min-feature advisory (Decision 5, § 2.7):
 * - When shrinking would push the finest features below a printable floor, return a
 *   non-blocking advisory message. Never blocks, never affects billing.
 */

import sharp from "sharp";
import { assertSafeFetchUrl } from "../../net/ssrfGuard";
import { fetchWithTimeout, TIMEOUT } from "../../../fetchTimeout";

/**
 * Resolve a /manus-storage/ path to a fetchable URL, or return the input unchanged.
 * This avoids importing storageGetSignedUrl directly to keep the guard testable.
 */
export type UrlResolver = (url: string) => Promise<string>;

/** Minimum effective DPI for upscale enforcement. */
export const MIN_EFFECTIVE_DPI = 150;

/** Minimum feature size in inches below which a scale-down advisory fires. */
export const MIN_FEATURE_INCHES = 0.02; // ~0.5mm — below typical screen/DTG resolution

export interface DpiGuardResult {
  /** If true, the request should be rejected pre-deduct. */
  reject: boolean;
  /** If true, a non-blocking warning should be logged/shown but not block. */
  warn: boolean;
  /** Human-readable message (for reject or warn). Null if neither. */
  message: string | null;
  /** Source DPI if available from metadata. */
  sourceDpi: number | null;
  /** Effective output DPI after scaling. Null if source DPI unknown. */
  effectiveDpi: number | null;
}

/**
 * Check whether an upscale operation would drop below the minimum DPI threshold.
 *
 * @param imageSource - URL (possibly /manus-storage/ path) or Buffer of the source image
 * @param scaleFactor - The multiplicative factor (f = (100 + percent) / 100). f > 1 is enlarge.
 * @param resolveUrl - Optional resolver for /manus-storage/ paths. If not provided, URLs are passed directly to sharp.
 * @returns DpiGuardResult with reject/warn/message
 */
export async function checkUpscaleDpi(
  imageSource: string | Buffer,
  scaleFactor: number,
  resolveUrl?: UrlResolver
): Promise<DpiGuardResult> {
  // Only relevant for upscale
  if (scaleFactor <= 1) {
    return { reject: false, warn: false, message: null, sourceDpi: null, effectiveDpi: null };
  }

  let sourceDpi: number | null = null;

  try {
    let input: string | Buffer = imageSource;
    if (typeof imageSource === "string" && resolveUrl) {
      input = await resolveUrl(imageSource);
    }
    // For URLs, fetch the image buffer first (sharp can't read remote URLs directly).
    // Route through the SSRF guard + timeout helper like every other server-side
    // image fetch, so this path can't be coerced into reaching internal hosts and
    // can't hang indefinitely on an unresponsive origin.
    let sharpInput: Buffer | string;
    if (typeof input === "string" && (input.startsWith("http://") || input.startsWith("https://"))) {
      await assertSafeFetchUrl(input);
      const resp = await fetchWithTimeout(input, {}, TIMEOUT.IMAGE_DOWNLOAD);
      if (!resp.ok) throw new Error(`Failed to fetch image: ${resp.status}`);
      sharpInput = Buffer.from(await resp.arrayBuffer());
    } else {
      sharpInput = input as Buffer | string;
    }
    const meta = await sharp(sharpInput).metadata();
    // sharp reports density in DPI (pixels per inch)
    sourceDpi = meta.density ?? null;
  } catch {
    // Can't read metadata — treat as unknown
    sourceDpi = null;
  }

  if (sourceDpi === null || sourceDpi <= 0) {
    // No DPI metadata — warn-only (Decision 2: "the basis is unknown")
    return {
      reject: false,
      warn: true,
      message:
        `This image has no DPI metadata. Upscaling by ${Math.round((scaleFactor - 1) * 100)}% ` +
        `may reduce print quality. Consider using a higher-resolution source.`,
      sourceDpi: null,
      effectiveDpi: null,
    };
  }

  const effectiveDpi = sourceDpi / scaleFactor;

  if (effectiveDpi < MIN_EFFECTIVE_DPI) {
    return {
      reject: true,
      warn: false,
      message:
        `Upscaling by ${Math.round((scaleFactor - 1) * 100)}% would reduce effective DPI ` +
        `from ${sourceDpi} to ${Math.round(effectiveDpi)} (minimum: ${MIN_EFFECTIVE_DPI}). ` +
        `Use a higher-resolution source image or reduce the scale percentage.`,
      sourceDpi,
      effectiveDpi,
    };
  }

  return { reject: false, warn: false, message: null, sourceDpi, effectiveDpi };
}

/**
 * Scale-down min-feature advisory (Decision 5, § 2.7).
 * Non-blocking: returns a warning message if shrinking would push features below
 * the printable floor, but never rejects.
 *
 * @param sourceDpi - Source image DPI (null if unknown)
 * @param scaleFactor - The multiplicative factor (f < 1 is shrink)
 * @param smallestFeaturePx - Size of the smallest motif feature in pixels (estimated or measured)
 * @returns Advisory message or null
 */
export function checkScaleDownAdvisory(
  sourceDpi: number | null,
  scaleFactor: number,
  smallestFeaturePx: number
): string | null {
  // Only relevant for downscale
  if (scaleFactor >= 1 || sourceDpi === null || sourceDpi <= 0) {
    return null;
  }

  const featureSizeInches = (smallestFeaturePx * scaleFactor) / sourceDpi;

  if (featureSizeInches < MIN_FEATURE_INCHES) {
    return (
      `Scaling down to ${Math.round(scaleFactor * 100)}% would shrink the finest features ` +
      `to approximately ${(featureSizeInches * 25.4).toFixed(2)}mm, which may be below ` +
      `the printable resolution for most output methods. This is advisory only — ` +
      `the operation will proceed.`
    );
  }

  return null;
}
