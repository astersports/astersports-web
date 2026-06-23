/**
 * T3.1 — Segmentation cache per (image, bbox).
 *
 * Skips the dominant SAM2 cost on re-runs of the same garment (iterate-on-one-garment
 * path currently re-segments every time). Cache key = hash(imageUrl) + bbox + model
 * version. Same LRU substrate as decodeUpright (in-memory, bounded, inflight-coalesced).
 *
 * Output-neutral: second identical request returns cached masks (no model call); output
 * byte-identical to first. Pure latency/cost win.
 */
import { createHash } from "node:crypto";
import type { Sam2Segmentation } from "./replicateSam2";
import type { BBoxNormalized } from "./types";

interface SegCacheEntry {
  segmentation: Sam2Segmentation;
}

const MAX_CACHE = 4; // Small — each entry holds combined + individual mask PNGs (~2-8 MB total)
const cache = new Map<string, SegCacheEntry>();
const inflight = new Map<string, Promise<SegCacheEntry>>();

/** Build a deterministic cache key from image URL + bbox + model version. */
function cacheKey(imageUrl: string, bbox: BBoxNormalized, modelVersion?: string): string {
  const h = createHash("sha256");
  h.update(imageUrl);
  // bbox is normalized [0,1] — round to 4 decimal places to avoid float drift
  h.update(`|${bbox.x.toFixed(4)},${bbox.y.toFixed(4)},${bbox.w.toFixed(4)},${bbox.h.toFixed(4)}`);
  if (modelVersion) h.update(`|${modelVersion}`);
  return h.digest("hex").slice(0, 32);
}

/**
 * Get or compute a segmentation result. If the same (imageUrl, bbox) is already cached
 * or in-flight, returns the cached result without calling the model.
 *
 * @param imageUrl - The source image URL (used as part of the cache key)
 * @param bbox - The normalized bounding box (crop region)
 * @param compute - The function that actually calls SAM2 (only invoked on cache miss)
 * @param modelVersion - Optional model version string for cache key differentiation
 */
export async function cachedSegmentation(
  imageUrl: string,
  bbox: BBoxNormalized,
  compute: () => Promise<Sam2Segmentation>,
  modelVersion?: string
): Promise<Sam2Segmentation> {
  const key = cacheKey(imageUrl, bbox, modelVersion);

  const cached = cache.get(key);
  if (cached) {
    console.log(`[seg-cache] HIT key=${key.slice(0, 8)}… (skipping SAM2 call)`);
    return cached.segmentation;
  }

  // Inflight coalescing: if another request is already computing this exact segmentation,
  // piggyback on it instead of launching a duplicate SAM2 call.
  let pending = inflight.get(key);
  if (!pending) {
    pending = (async () => {
      const segmentation = await compute();
      return { segmentation };
    })();
    inflight.set(key, pending);
    void pending.catch(() => {}).finally(() => inflight.delete(key));
  }

  const entry = await pending;
  cache.set(key, entry);

  // LRU eviction (oldest insertion first — Map preserves insertion order)
  if (cache.size > MAX_CACHE) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }

  console.log(`[seg-cache] MISS key=${key.slice(0, 8)}… (cached for next call)`);
  return entry.segmentation;
}

/** Test/maintenance hook — clears the segmentation cache. */
export function clearSegCache(): void {
  cache.clear();
  inflight.clear();
}
