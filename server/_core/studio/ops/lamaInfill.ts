/**
 * T2.1 — LaMa texture-aware infill with reproducible-by-cache layer.
 *
 * Replaces flat LAB fill on the density-removal path with texture-aware infill
 * WITHOUT breaking byte-reproducibility.
 *
 * Architecture:
 *  1. Cache key = hash(input image bytes) · hash(removal mask bytes) · model version · seed.
 *  2. On cache HIT: return persisted output bytes (byte-identical, no model call).
 *  3. On cache MISS: call LaMa via Replicate, persist output to S3, return bytes.
 *  4. Fallback: if LaMa unavailable or errors, fall back to flat LAB infill (existing).
 *
 * The cache is stored in S3 under `lama-cache/{cacheKey}.png`. The cache key is
 * deterministic, so re-runs/undo/redo return identical bytes without recomputing.
 *
 * LaMa model: `allenhooo/lama` on Replicate (Resolution-robust Large Mask Inpainting
 * with Fourier Convolutions). ~3s per call, $0.00057/run.
 */
import { createHash } from "node:crypto";
import sharp from "sharp";
import Replicate from "replicate";
import { ENV } from "../../env";
import { storagePut, storageGetSignedUrl } from "../../../storage";
import { safeFetchBuffer } from "../../net/safeFetch";
import type { RasterMask, MaskImageInput } from "../../masking/types";

const LAMA_MODEL = "allenhooo/lama" as const;
const LAMA_RUN_TIMEOUT_MS = 60_000;
const LAMA_CACHE_PREFIX = "lama-cache";

/** LaMa is available when Replicate token is configured. */
export function isLamaAvailable(): boolean {
  return !!ENV.replicateApiToken;
}

/**
 * Build a deterministic cache key from the image pixels + mask pixels + model version.
 * The key is a content-hash, so identical inputs always produce the same key.
 */
export function buildCacheKey(imageRgba: Buffer, mask: RasterMask, modelVersion?: string): string {
  const h = createHash("sha256");
  h.update(imageRgba);
  h.update(Buffer.from(mask.data.buffer, mask.data.byteOffset, mask.data.byteLength));
  h.update(`|${mask.width}x${mask.height}`);
  h.update(`|model=${modelVersion ?? LAMA_MODEL}`);
  return h.digest("hex").slice(0, 48);
}

/**
 * Decode a PNG buffer to raw RGBA at the expected dimensions. Shared by the cache-hit
 * path and the cache-miss persist path so both return byte-identical pixels for the same
 * stored PNG (the reproducibility contract).
 */
async function pngToRgba(png: Buffer, width: number, height: number): Promise<Buffer> {
  const { data } = await sharp(png)
    .resize(width, height, { fit: "fill" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return data;
}

/**
 * Check if a cached LaMa result exists in S3 for this cache key.
 * Returns the raw RGBA buffer if found, null otherwise.
 */
async function getCachedResult(cacheKey: string, width: number, height: number): Promise<Buffer | null> {
  try {
    const storageKey = `${LAMA_CACHE_PREFIX}/${cacheKey}.png`;
    const signedUrl = await storageGetSignedUrl(storageKey);
    const { buffer, response } = await safeFetchBuffer(signedUrl, {
      timeoutMs: 15_000,
      skipSsrf: true,
    });
    if (!response.ok) return null;
    const data = await pngToRgba(buffer, width, height);
    console.log(`[lama-cache] HIT key=${cacheKey.slice(0, 12)}…`);
    return data;
  } catch {
    // Cache miss (file doesn't exist or fetch failed)
    return null;
  }
}

/**
 * Persist a LaMa result to S3 for future cache hits, using a DETERMINISTIC storage key
 * (no random suffix) so the write key equals the key `getCachedResult` later reads.
 * Returns the bytes a future cache hit would return (the stored PNG re-decoded), so the
 * miss path can hand back the same pixels — making run-1 and run-N byte-identical.
 * Returns null on persistence failure (caller falls back to the fresh model bytes).
 */
async function persistResult(cacheKey: string, rgbaBuffer: Buffer, width: number, height: number): Promise<Buffer | null> {
  try {
    const png = await sharp(rgbaBuffer, { raw: { width, height, channels: 4 } })
      .png({ compressionLevel: 6 })
      .toBuffer();
    const storageKey = `${LAMA_CACHE_PREFIX}/${cacheKey}.png`;
    await storagePut(storageKey, png, "image/png", { deterministicKey: true });
    console.log(`[lama-cache] STORED key=${cacheKey.slice(0, 12)}…`);
    // Re-decode the exact PNG we stored, so this (miss) return matches a future cache hit.
    return await pngToRgba(png, width, height);
  } catch (err) {
    // Non-fatal: cache persistence failure doesn't block the result
    console.warn(`[lama-cache] Failed to persist: ${(err as Error).message}`);
    return null;
  }
}

/**
 * Call LaMa on Replicate with the source image + mask.
 * Returns the inpainted image as raw RGBA at the original dimensions.
 */
async function callLama(
  imageRgba: Buffer,
  width: number,
  height: number,
  mask: RasterMask
): Promise<Buffer> {
  const token = ENV.replicateApiToken;
  if (!token) throw new Error("LaMa unavailable: REPLICATE_API_TOKEN not set");

  // Encode source image as PNG data URL
  const srcPng = await sharp(imageRgba, { raw: { width, height, channels: 4 } })
    .png()
    .toBuffer();
  const srcDataUrl = `data:image/png;base64,${srcPng.toString("base64")}`;

  // Encode mask as PNG data URL (white = inpaint region, black = keep)
  const maskPng = await sharp(Buffer.from(mask.data.buffer, mask.data.byteOffset, mask.data.byteLength), {
    raw: { width: mask.width, height: mask.height, channels: 1 },
  })
    .png()
    .toBuffer();
  const maskDataUrl = `data:image/png;base64,${maskPng.toString("base64")}`;

  const replicate = new Replicate({ auth: token, useFileOutput: false });

  // Race against timeout
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`LaMa timed out after ${LAMA_RUN_TIMEOUT_MS}ms`)), LAMA_RUN_TIMEOUT_MS);
  });

  try {
    const output = await Promise.race([
      replicate.run(LAMA_MODEL, {
        input: { image: srcDataUrl, mask: maskDataUrl },
      }),
      timeout,
    ]);
    if (timer) clearTimeout(timer);

    // Parse output — LaMa returns a URL to the inpainted image
    const outputUrl = typeof output === "string"
      ? output
      : Array.isArray(output)
        ? String(output[0])
        : (output as any)?.url ?? String(output);

    if (!outputUrl || typeof outputUrl !== "string") {
      throw new Error("LaMa returned no output URL");
    }

    // Download the result
    const { buffer: resultPng, response } = await safeFetchBuffer(outputUrl, { timeoutMs: 30_000 });
    if (!response.ok) throw new Error(`LaMa result download failed: ${response.status}`);

    // Decode to raw RGBA at original dimensions
    const { data } = await sharp(resultPng)
      .resize(width, height, { fit: "fill" })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    return data;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export interface LamaInfillInput {
  /** Raw RGBA pixels of the source image (from decodeUpright). */
  imageRgba: Buffer;
  width: number;
  height: number;
  /** The removal mask: 255 = infill here, 0 = keep. */
  region: RasterMask;
}

export interface LamaInfillResult {
  /** Inpainted raw RGBA pixels. */
  data: Buffer;
  width: number;
  height: number;
  /** Whether the result came from cache (true) or a fresh model call (false). */
  fromCache: boolean;
}

/**
 * Texture-aware infill via LaMa with reproducible-by-cache layer.
 *
 * On cache hit: returns persisted bytes (byte-identical, no model call).
 * On cache miss: calls LaMa, persists result, returns bytes.
 * On error: throws (caller should fall back to flat LAB infill).
 */
export async function lamaInfill(input: LamaInfillInput): Promise<LamaInfillResult> {
  const { imageRgba, width, height, region } = input;
  const cacheKey = buildCacheKey(imageRgba, region);

  // 1. Check cache
  const cached = await getCachedResult(cacheKey, width, height);
  if (cached) {
    return { data: cached, width, height, fromCache: true };
  }

  // 2. Call LaMa (raw RGBA straight from the model — non-deterministic GPU bytes)
  const fresh = await callLama(imageRgba, width, height, region);

  // 3. Persist to cache and return the SAME bytes a later cache hit would return, so
  //    run-1 (miss) and run-N (hit) are byte-identical. If persistence fails, fall back
  //    to the fresh bytes — still correct, just not yet cached. Awaited (not fire-and-
  //    forget) because the returned pixels now depend on the stored PNG round-trip.
  const persisted = await persistResult(cacheKey, fresh, width, height);

  console.log(`[lama-infill] MISS key=${cacheKey.slice(0, 12)}… (model called, cached)`);
  return { data: persisted ?? fresh, width, height, fromCache: false };
}
