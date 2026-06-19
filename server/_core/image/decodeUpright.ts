/**
 * decodeUpright — the single orientation-normalization boundary for all
 * deterministic Print Studio raster ops (Amendment 1 §13 ruling on the EXIF
 * boundary; A1 spec).
 *
 * Downloads an image, bakes EXIF orientation via sharp `.rotate()`, and returns
 * raw RGBA pixels + upright dimensions. Every raster consumer (the provider's
 * future raster step, A1 separation remap, scale, density) decodes here so the
 * normalized `bbox` and the pixels always live in ONE coordinate frame — the
 * orientation bug from the first audit is fixed in exactly this one place.
 *
 * Memoized with a small LRU keyed by url so the provider raster path and the ops
 * share one decode. Callers receive a COPY of the pixel buffer, so in-place
 * mutation never corrupts the cache.
 */
import sharp from "sharp";
import { storageGetSignedUrl } from "../../storage";
import { fetchWithTimeout, TIMEOUT } from "../../fetchTimeout";

export interface UprightImage {
  /** Raw RGBA pixels, length = width * height * 4. */
  buffer: Buffer;
  width: number;
  height: number;
}

interface CacheEntry {
  buffer: Buffer;
  width: number;
  height: number;
}

const MAX_CACHE = 8;
const cache = new Map<string, CacheEntry>();

/** Test/maintenance hook — clears the decode cache. */
export function clearDecodeCache(): void {
  cache.clear();
}

async function resolveAccessibleUrl(url: string): Promise<string> {
  if (url.startsWith("/manus-storage/")) {
    return storageGetSignedUrl(url.replace("/manus-storage/", ""));
  }
  return url;
}

async function decodeToEntry(url: string): Promise<CacheEntry> {
  const accessible = await resolveAccessibleUrl(url);
  const res = await fetchWithTimeout(accessible, {}, TIMEOUT.IMAGE_DOWNLOAD);
  if (!res.ok) {
    throw new Error(`decodeUpright: failed to download image (${res.status} ${res.statusText})`);
  }
  const input = Buffer.from(await res.arrayBuffer());
  // `.rotate()` with no args bakes the EXIF orientation tag into the pixels.
  const { data, info } = await sharp(input)
    .rotate()
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { buffer: data, width: info.width, height: info.height };
}

export async function decodeUpright(url: string): Promise<UprightImage> {
  let entry = cache.get(url);
  if (!entry) {
    entry = await decodeToEntry(url);
    cache.set(url, entry);
    // Evict oldest insertion (Map preserves insertion order).
    if (cache.size > MAX_CACHE) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
  }
  // Hand back a copy so ops can mutate freely without corrupting the cache.
  return {
    buffer: Buffer.from(entry.buffer),
    width: entry.width,
    height: entry.height,
  };
}
