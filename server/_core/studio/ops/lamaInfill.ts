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
    // Decode the cached PNG back to raw RGBA at the expected dimensions
    const { data } = await sharp(buffer)
      .resize(width, height, { fit: "fill" })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    console.log(`[lama-cache] HIT key=${cacheKey.slice(0, 12)}…`);
    return data;
  } catch {
    // Cache miss (file doesn't exist or fetch failed)
    return null;
  }
}

/**
 * Persist a LaMa result to S3 for future cache hits.
 */
async function persistResult(cacheKey: string, rgbaBuffer: Buffer, width: number, height: number): Promise<void> {
  try {
    const png = await sharp(rgbaBuffer, { raw: { width, height, channels: 4 } })
      .png({ compressionLevel: 6 })
      .toBuffer();
    const storageKey = `${LAMA_CACHE_PREFIX}/${cacheKey}.png`;
    // deterministicKey: the cache key IS the content hash, so the write address must be
    // stable and equal to what getCachedResult reads (no random suffix) or the cache never hits.
    await storagePut(storageKey, png, "image/png", { deterministicKey: true });
    console.log(`[lama-cache] STORED key=${cacheKey.slice(0, 12)}…`);
  } catch (err) {
    // Non-fatal: cache persistence failure doesn't block the result
    console.warn(`[lama-cache] Failed to persist: ${(err as Error).message}`);
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

  // 2. Call LaMa
  const result = await callLama(imageRgba, width, height, region);

  // 3. Persist to cache, then return the PERSISTED-and-re-read bytes (not the fresh GPU
  // output) so run 1 is byte-identical to every later cache hit (NFR-1 — the model is not
  // byte-reproducible across GPU/driver, the persisted PNG is). Fall back to the fresh
  // result only if persist/re-read fails (degraded determinism, but still delivers).
  await persistResult(cacheKey, result, width, height);
  const canonical = await getCachedResult(cacheKey, width, height);

  console.log(`[lama-infill] MISS key=${cacheKey.slice(0, 12)}… (model called, cached)`);
  return { data: canonical ?? result, width, height, fromCache: false };
}
