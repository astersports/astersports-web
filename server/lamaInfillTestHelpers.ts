/**
 * Test helpers for T2.1 LaMa infill tests.
 * Exposes the deterministic cache key builder for unit testing.
 */
import { createHash } from "node:crypto";
import type { RasterMask } from "../server/_core/masking/types";

const LAMA_MODEL = "allenhooo/lama";

/**
 * Build a deterministic cache key from the image pixels + mask pixels + model version.
 * Identical to the production implementation in lamaInfill.ts.
 */
export function buildCacheKey(imageRgba: Buffer, mask: RasterMask, modelVersion?: string): string {
  const h = createHash("sha256");
  h.update(imageRgba);
  h.update(Buffer.from(mask.data.buffer, mask.data.byteOffset, mask.data.byteLength));
  h.update(`|${mask.width}x${mask.height}`);
  h.update(`|model=${modelVersion ?? LAMA_MODEL}`);
  return h.digest("hex").slice(0, 48);
}
