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
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { storageGetSignedUrl } from "../../storage";
import { fetchWithTimeout, TIMEOUT } from "../../fetchTimeout";
import { assertWithinPixelLimit, decodeSemaphore, maxInputPixels } from "./guards";
import { assertSafeFetchUrl } from "../net/ssrfGuard";
import { ENV } from "../env";

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

/**
 * Read raw image bytes from a storage key, http(s) URL, file:// URL, or local
 * filesystem path. Local-path support keeps the eval harness runnable offline on
 * Frank's own sample garments (no Forge storage round-trip).
 */
async function readImageBytes(url: string): Promise<Buffer> {
  if (url.startsWith("file://")) {
    // M7: file:// is an eval-only offline convenience. Reading the local FS from
    // a request-reachable code path is an LFI vector, so it is closed in prod.
    if (ENV.isProduction) throw new Error("decodeUpright: file:// sources are not allowed in production");
    return readFile(fileURLToPath(url));
  }
  if (url.startsWith("/manus-storage/")) {
    // Internal storage key -> Forge-signed URL (trusted host); no SSRF check needed.
    const signed = await storageGetSignedUrl(url.replace("/manus-storage/", ""));
    return fetchToBuffer(signed, { trusted: true });
  }
  if (url.startsWith("http://") || url.startsWith("https://")) {
    return fetchToBuffer(url);
  }
  // Bare filesystem path — eval-only, same LFI reasoning as file:// above.
  if (ENV.isProduction) throw new Error("decodeUpright: local-path sources are not allowed in production");
  return readFile(url);
}

async function fetchToBuffer(url: string, opts: { trusted?: boolean } = {}): Promise<Buffer> {
  // M7: validate untrusted http(s) destinations resolve to a public address.
  if (!opts.trusted) await assertSafeFetchUrl(url);
  const res = await fetchWithTimeout(url, {}, TIMEOUT.IMAGE_DOWNLOAD);
  if (!res.ok) {
    throw new Error(`decodeUpright: failed to download image (${res.status} ${res.statusText})`);
  }
  return Buffer.from(await res.arrayBuffer());
}

async function decodeToEntry(url: string): Promise<CacheEntry> {
  const input = await readImageBytes(url);
  // `.rotate()` with no args bakes the EXIF orientation tag into the pixels.
  // H6: `limitInputPixels` makes sharp reject an oversized image before it
  // allocates the raw RGBA frame; the post-decode assert is a second line.
  const { data, info } = await sharp(input, { limitInputPixels: maxInputPixels() })
    .rotate()
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  assertWithinPixelLimit(info.width, info.height);
  return { buffer: data, width: info.width, height: info.height };
}

export async function decodeUpright(url: string): Promise<UprightImage> {
  let entry = cache.get(url);
  if (!entry) {
    // H6: bound concurrent decodes so N parallel jobs can't each hold a full
    // RGBA frame at once. Cache hits skip the semaphore entirely.
    entry = await decodeSemaphore.run(() => decodeToEntry(url));
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
