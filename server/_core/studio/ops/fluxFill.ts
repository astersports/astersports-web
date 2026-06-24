/**
 * SPIKE (hybrid generative fill) — FLUX.1 Fill infill provider, a drop-in alternative to
 * lamaInfill for the density removal/reconstruction step. Same SAM2 selection upstream; only
 * the FILL of the revealed fabric changes from LaMa (feed-forward, smears on structured cloth)
 * to FLUX.1 Fill (12B rectified-flow inpainter, mask-conditioned).
 *
 * Mirrors lamaInfill's interface (LamaInfillInput/Result) so density ops can swap providers
 * with no other change. Two things this adds over lamaInfill, per the model research:
 *
 *  1. REQUIRED pixel-space composite under the mask (`compositeUnderMask`). No latent-diffusion
 *     fill — FLUX included — keeps pixels OUTSIDE the mask identical: the VAE shifts colour /
 *     adds seams globally (arXiv 2512.05198, 2512.03247). So we take ONLY the masked region of
 *     FLUX's decode and paste it back over the ORIGINAL pixels. Outside-mask is then byte-exact
 *     by construction — never trust the model's full-frame output. This function is pure + unit-
 *     tested without a model call.
 *  2. Determinism via the SAME content-hash cache as lamaInfill. FLUX [pro]'s seed-reproducibility
 *     isn't guaranteed, but persisting the first output by content hash makes undo/redo
 *     reproducible regardless (run 1 == every later hit).
 *
 * DARK: gated behind STUDIO_INFILL_PROVIDER=flux (default lama). Routing customer images to BFL
 * (via Replicate) is a NEW sub-processor — needs Frank's §1 sign-off + disclosure + a BFL
 * commercial licence (the open FLUX.1-dev weights are Non-Commercial) BEFORE any customer image
 * flows. Until then this is eval-only on test images.
 */
import { createHash } from "node:crypto";
import sharp from "sharp";
import Replicate from "replicate";
import { ENV } from "../../env";
import { storagePut, storageGetSignedUrl } from "../../../storage";
import { safeFetchBuffer } from "../../net/safeFetch";
import type { RasterMask } from "../../masking/types";
import type { LamaInfillInput, LamaInfillResult } from "./lamaInfill";

/** flux-fill-pro = quality; flux-fill-dev = strict bf16+seed determinism (override via env). */
const FLUX_FILL_MODEL = (ENV.studioFluxFillModel || "black-forest-labs/flux-fill-pro") as `${string}/${string}`;
const FLUX_RUN_TIMEOUT_MS = 60_000;
const FLUX_CACHE_PREFIX = "flux-fill-cache";
const FLUX_SEED = 1;
/** Guidance toward bare fabric, NOT new motifs — flux-fill is prompt-conditioned; an empty
 *  prompt invites hallucinated pattern in the hole we are trying to clear. */
const FABRIC_PROMPT =
  "plain unprinted fabric matching the surrounding garment material, same colour weave drape and lighting, seamless, no print, no pattern, no motif";

/**
 * Take ONLY the masked region from `filled`; keep `original` everywhere else. This is the
 * pixel-identity guarantee the research flagged as REQUIRED for latent-diffusion fill — outside
 * the mask the output is byte-identical to the input. Pure + deterministic.
 *
 * `region`: 255 = filled-from-model, 0 = keep-original (same polarity as lamaInfill's region and
 * FLUX's white=inpaint mask). Both buffers are raw RGBA of width*height*4.
 */
export function compositeUnderMask(
  original: Buffer,
  filled: Buffer,
  region: RasterMask,
  width: number,
  height: number
): Buffer {
  const out = Buffer.from(original); // copy → outside-mask pixels preserved exactly
  const n = width * height;
  const sameDims = region.width === width && region.height === height;
  for (let i = 0; i < n; i++) {
    const m = sameDims ? region.data[i] : region.data[Math.min(region.data.length - 1, i)];
    if (m > 127) {
      const p = i * 4;
      out[p] = filled[p];
      out[p + 1] = filled[p + 1];
      out[p + 2] = filled[p + 2];
      out[p + 3] = filled[p + 3];
    }
  }
  return out;
}

export function isFluxFillAvailable(): boolean {
  return !!ENV.replicateApiToken;
}

/** Content-hash cache key: image · mask · model · seed. Identical inputs → identical key. */
export function buildFluxCacheKey(imageRgba: Buffer, mask: RasterMask, seed = FLUX_SEED): string {
  const h = createHash("sha256");
  h.update(imageRgba);
  h.update(Buffer.from(mask.data.buffer, mask.data.byteOffset, mask.data.byteLength));
  h.update(`|${mask.width}x${mask.height}`);
  h.update(`|model=${FLUX_FILL_MODEL}|seed=${seed}`);
  return h.digest("hex").slice(0, 48);
}

async function getCachedResult(cacheKey: string, width: number, height: number): Promise<Buffer | null> {
  try {
    const signedUrl = await storageGetSignedUrl(`${FLUX_CACHE_PREFIX}/${cacheKey}.png`);
    const { buffer, response } = await safeFetchBuffer(signedUrl, { timeoutMs: 15_000, skipSsrf: true });
    if (!response.ok) return null;
    const { data } = await sharp(buffer).resize(width, height, { fit: "fill" }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    return data;
  } catch {
    return null;
  }
}

async function persistResult(cacheKey: string, rgbaBuffer: Buffer, width: number, height: number): Promise<void> {
  try {
    const png = await sharp(rgbaBuffer, { raw: { width, height, channels: 4 } }).png({ compressionLevel: 6 }).toBuffer();
    await storagePut(`${FLUX_CACHE_PREFIX}/${cacheKey}.png`, png, "image/png", { deterministicKey: true });
  } catch (err) {
    console.warn(`[flux-cache] persist failed: ${(err as Error).message}`);
  }
}

/** Call FLUX.1 Fill on Replicate with image + mask; return the model's full-frame decode (RGBA). */
async function callFluxFill(imageRgba: Buffer, width: number, height: number, mask: RasterMask, seed: number): Promise<Buffer> {
  const token = ENV.replicateApiToken;
  if (!token) throw new Error("FLUX Fill unavailable: REPLICATE_API_TOKEN not set");

  const srcPng = await sharp(imageRgba, { raw: { width, height, channels: 4 } }).png().toBuffer();
  const maskPng = await sharp(
    Buffer.from(mask.data.buffer, mask.data.byteOffset, mask.data.byteLength),
    { raw: { width: mask.width, height: mask.height, channels: 1 } }
  ).png().toBuffer();

  const replicate = new Replicate({ auth: token, useFileOutput: false });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`FLUX Fill timed out after ${FLUX_RUN_TIMEOUT_MS}ms`)), FLUX_RUN_TIMEOUT_MS);
  });

  try {
    const output = await Promise.race([
      replicate.run(FLUX_FILL_MODEL, {
        input: {
          image: `data:image/png;base64,${srcPng.toString("base64")}`,
          mask: `data:image/png;base64,${maskPng.toString("base64")}`,
          prompt: FABRIC_PROMPT,
          seed,
          go_fast: false, // inpainting forces bf16 anyway; bf16+seed is the deterministic path
          output_format: "png",
        },
      }),
      timeout,
    ]);
    if (timer) clearTimeout(timer);

    const outputUrl = typeof output === "string" ? output : Array.isArray(output) ? String(output[0]) : (output as any)?.url ?? String(output);
    if (!outputUrl || typeof outputUrl !== "string") throw new Error("FLUX Fill returned no output URL");

    const { buffer: resultPng, response } = await safeFetchBuffer(outputUrl, { timeoutMs: 30_000 });
    if (!response.ok) throw new Error(`FLUX Fill result download failed: ${response.status}`);

    const { data } = await sharp(resultPng).resize(width, height, { fit: "fill" }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    return data;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * FLUX.1 Fill infill, drop-in for lamaInfill. Calls the model, then composites ONLY the masked
 * region back over the original (pixel-identity outside the mask), with a reproducible-by-cache
 * layer. On error → throws (caller falls back to lamaInfill/flat, same as the LaMa path).
 */
export async function fluxFill(input: LamaInfillInput & { seed?: number }): Promise<LamaInfillResult> {
  const { imageRgba, width, height, region } = input;
  const seed = input.seed ?? FLUX_SEED;
  const cacheKey = buildFluxCacheKey(imageRgba, region, seed);

  const cached = await getCachedResult(cacheKey, width, height);
  if (cached) return { data: cached, width, height, fromCache: true };

  const modelOut = await callFluxFill(imageRgba, width, height, region, seed);
  // The decisive step: paste-back under the mask so outside-mask stays byte-identical.
  const composited = compositeUnderMask(imageRgba, modelOut, region, width, height);

  await persistResult(cacheKey, composited, width, height);
  const canonical = await getCachedResult(cacheKey, width, height);
  return { data: canonical ?? composited, width, height, fromCache: false };
}
