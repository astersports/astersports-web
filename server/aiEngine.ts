/**
 * AI Engine for Print Studio.
 * Handles element detection (via LLM vision) and image editing (via generateImage).
 * Uses textile and fashion industry terminology for precision.
 *
 * Security & Reliability:
 * - All fetch calls use AbortController timeouts to prevent indefinite hangs
 * - Image size is validated before base64 encoding to prevent OOM
 * - Signed URLs are not logged in production to avoid credential leakage
 */
import { invokeLLM } from "./_core/llm";
import { generateImage } from "./_core/imageGeneration";
import { storageGetSignedUrl } from "./storage";
import { fetchWithTimeout, TIMEOUT } from "./fetchTimeout";
import { ENV } from "./_core/env";
import sharp from "sharp";
import { getMaskProvider } from "./_core/masking";
import { separationRemap } from "./_core/studio/ops/separationRemap";
import { densityThin } from "./_core/studio/ops/densityThin";
import { scalePrintRepeat } from "./_core/studio/ops/scaleRepeat";
import type { RasterMask } from "./_core/masking/types";

/**
 * Deterministic density (D-C): SAM2 fabric raster + instance masks -> densityThin -> PNG.
 *
 * SINGLE-CALL: one getSegmentation() yields both fabric + instances (no double SAM2
 * call). Returns null on a DEGRADE (no raster / no instances) OR a genuine no-op
 * (removed === 0). The caller (studio.generate) treats null as FAIL + REFUND —
 * density NEVER prompt-falls, because the generative path cannot do count-based
 * removal (it would silently ignore the density ask). Deterministic; no model call.
 */
export async function generateDensityImage(
  originalImageUrl: string,
  percent: number
): Promise<{ png: Buffer; removed: number } | null> {
  const srcUrl = originalImageUrl.startsWith("/manus-storage/")
    ? await storageGetSignedUrl(originalImageUrl.replace("/manus-storage/", ""))
    : originalImageUrl;

  // Single SAM2 call -> fabric + instances.
  const { fabric, instances } = await getMaskProvider().getSegmentation({ url: srcUrl });
  if (!fabric.raster || instances.length === 0) {
    // Degrade (no raster / no instances) -> fail + refund (not prompt-fall).
    console.warn(`[density-live] Provider degraded (no raster or 0 instances); fail + refund.`);
    return null;
  }

  const result = await densityThin({ image: { url: srcUrl }, fabric, instances, percent });

  // D-C no-op guard: the op ran but removed nothing (e.g. too few motifs for the
  // requested percent) — refund rather than bill for an unchanged image.
  if (result.removed === 0) {
    console.warn(`[density-live] densityThin removed 0 motifs; no-op -> fail + refund.`);
    return null;
  }

  const png = await sharp(result.data, {
    raw: { width: result.width, height: result.height, channels: 4 },
  })
    .png()
    .toBuffer();

  return { png, removed: result.removed };
}

/** Deterministic recolor (A2): classical fabric mask + separationRemap -> PNG bytes.
 *  Caller (studio.generate) stores the buffer + records the variation. No model
 *  call, no no-op guard (the op always applies). */
export async function generateRecoloredImage(
  originalImageUrl: string,
  params: { fromColor: string; toColor: string; coverage: number }
): Promise<Buffer> {
  const srcUrl = originalImageUrl.startsWith("/manus-storage/")
    ? await storageGetSignedUrl(originalImageUrl.replace("/manus-storage/", ""))
    : originalImageUrl;
  const fabric = await getMaskProvider().getFabricMask({ url: srcUrl }); // classical floor (bbox)
  return separationRemap({ url: srcUrl }, fabric, params);
}

/** D-C no-op-billing guard: true if the raster has any included pixel. */
function hasAnyPixel(raster: RasterMask): boolean {
  for (let i = 0; i < raster.data.length; i++) if (raster.data[i] > 127) return true;
  return false;
}

/** Sentinel: scale found no fabric region, so the op would be a no-op. */
export const NO_OP_SCALE_ERROR = "NO_OP_SCALE";

/** Deterministic scale (scale-live): SAM2 fabric raster + scalePrintRepeat -> PNG.
 *  Throws NO_OP_SCALE_ERROR on an empty fabric raster so the caller's refund path
 *  fires (D-C; scalePrintRepeat itself passes through on an empty mask, which would
 *  otherwise bill for a no-op). No model call, no generative no-op guard. */
export async function generateScaledImage(
  originalImageUrl: string,
  params: { targetFraction: number }
): Promise<Buffer> {
  const srcUrl = originalImageUrl.startsWith("/manus-storage/")
    ? await storageGetSignedUrl(originalImageUrl.replace("/manus-storage/", ""))
    : originalImageUrl;
  const fabric = await getMaskProvider().getFabricMask({ url: srcUrl }); // SAM2 raster (combined_mask)
  if (!fabric.raster || !hasAnyPixel(fabric.raster)) {
    throw new Error(NO_OP_SCALE_ERROR);
  }
  const r = await scalePrintRepeat({ image: { url: srcUrl }, fabric, targetFraction: params.targetFraction });
  return sharp(r.data, { raw: { width: r.width, height: r.height, channels: 4 } }).png().toBuffer();
}

/** Sentinel error: the model returned an image that did not apply the requested edit. */
export const NO_OP_EDIT_ERROR = "NO_OP_EDIT";

/** Maximum image size allowed for generation (5MB). Larger images are rejected. */
const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;

/**
 * System prompt for textile print element detection.
 * Uses industry-standard terminology to guide accurate motif identification.
 */
const ELEMENT_DETECTION_SYSTEM_PROMPT = `You are a senior textile print designer and colorist analyzing a product photograph of a printed garment. Your task is to identify every distinct visual motif or design element present in the fabric's surface print.

CLASSIFICATION GUIDELINES:
- Name each element using standard textile/fashion print terminology (2-5 words).
- Distinguish between primary motifs (hero elements that anchor the design) and secondary motifs (fillers, accents, ground textures).
- Use precise color descriptors: "dusty rose", "cobalt blue", "chartreuse", "ivory", not just "pink" or "blue".
- Identify motif types accurately:
  • Florals: "open peony heads", "scattered rosebuds", "trailing wisteria", "ditsy daisies", "abstract blooms"
  • Foliage: "pinnate fern fronds", "broad tropical leaves", "trailing ivy", "eucalyptus sprigs", "beaded stems"
  • Geometrics: "ogee lattice", "chevron stripes", "polka dots", "medallion tiles", "trellis grid"
  • Conversationals: "paisley teardrops", "toile figures", "animal silhouettes", "nautical anchors"
  • Textures/grounds: "stippled ground", "watercolor wash", "marbled veining", "lace overlay"
  • Accents: "metallic foil dots", "seed bead clusters", "fine pinstripes", "scattered sequins"

- Do NOT identify garment construction elements (seams, hems, zippers, buttons, labels).
- Do NOT identify the hanger, mannequin, or photographic background.
- Return 3-10 elements ordered from most visually dominant to least.

OUTPUT: Return ONLY a JSON object with an "elements" array of short descriptive strings.`;

/**
 * Detect natural-language element names from a garment print image.
 * Uses vision LLM with textile-specific prompting for accurate motif identification.
 */
export async function detectPrintElements(imageUrl: string): Promise<string[]> {
  // Get a publicly-accessible URL for the image
  let accessibleUrl = imageUrl;
  if (imageUrl.startsWith("/manus-storage/")) {
    const key = imageUrl.replace("/manus-storage/", "");
    accessibleUrl = await storageGetSignedUrl(key);
  }

  const response = await invokeLLM({
    messages: [
      {
        role: "system" as const,
        content: ELEMENT_DETECTION_SYSTEM_PROMPT,
      },
      {
        role: "user" as const,
        content: [
          {
            type: "image_url" as const,
            image_url: { url: accessibleUrl, detail: "high" as const },
          },
          {
            type: "text" as const,
            text: "Analyze this garment photograph. Identify and name every distinct print motif or design element visible on the fabric surface. Use precise textile terminology and color descriptors.",
          },
        ],
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "elements",
        strict: true,
        schema: {
          type: "object",
          properties: {
            elements: {
              type: "array",
              items: { type: "string" },
              description: "Array of textile print element names found in the fabric design",
            },
          },
          required: ["elements"],
          additionalProperties: false,
        },
      },
    },
  });

  try {
    const rawContent = response.choices?.[0]?.message?.content ?? "{}";
    const content = typeof rawContent === "string" ? rawContent : JSON.stringify(rawContent);
    const parsed = JSON.parse(content);
    return Array.isArray(parsed.elements) ? parsed.elements : [];
  } catch {
    console.error("[aiEngine] Failed to parse element detection response");
    return [];
  }
}

/**
 * Download an image from a URL with timeout and size validation.
 * Returns the base64-encoded image data and resolved MIME type.
 */
async function downloadImageAsBase64(
  url: string,
  fallbackMimeType: string = "image/jpeg"
): Promise<{ base64: string; mimeType: string }> {
  const response = await fetchWithTimeout(url, {}, TIMEOUT.IMAGE_DOWNLOAD);

  if (!response.ok) {
    throw new Error(`Failed to download image: ${response.status} ${response.statusText}`);
  }

  const contentType = response.headers.get("content-type") || fallbackMimeType;
  const buffer = Buffer.from(await response.arrayBuffer());

  // Validate image size before base64 encoding
  if (buffer.length > MAX_IMAGE_SIZE_BYTES) {
    throw new Error(
      `Image too large for generation: ${(buffer.length / 1024 / 1024).toFixed(1)}MB exceeds ` +
      `${(MAX_IMAGE_SIZE_BYTES / 1024 / 1024).toFixed(0)}MB limit. Please use a smaller image.`
    );
  }

  console.log(`[aiEngine] Image downloaded: ${(buffer.length / 1024).toFixed(0)}KB, mime: ${contentType}`);

  return {
    base64: buffer.toString("base64"),
    mimeType: contentType,
  };
}

/** Resolve a storage path or URL into a URL the LLM service can fetch. */
async function resolveAccessibleUrl(url: string): Promise<string> {
  if (url.startsWith("/manus-storage/")) {
    return storageGetSignedUrl(url.replace("/manus-storage/", ""));
  }
  return url;
}

/** Strict QA prompt for the no-op guard. */
const NOOP_JUDGE_SYSTEM_PROMPT =
  "You are a strict QA reviewer for a textile-print editing tool. You are shown an ORIGINAL " +
  "garment photo and an EDITED version, plus a description of the change that was requested. " +
  "Decide whether the requested change is ACTUALLY VISIBLE in the edited image compared to the " +
  "original. Ignore minor differences from JPEG compression, resolution, or tiny lighting shifts. " +
  "Set changed=false only when the two images are essentially identical for the requested change " +
  "(i.e. the edit was not applied). Be confident: set a high confidence when the verdict is clear.";

/**
 * No-op guard: ask the vision LLM whether the requested edit is visible in the result.
 * Returns "applied", "noop" (confident the edit did NOT happen), or "unknown" (could not
 * judge — caller should fail open and keep the result rather than refunding).
 */
async function judgeEditApplied(
  originalImageUrl: string,
  resultImageUrl: string,
  expectation: string
): Promise<"applied" | "noop" | "unknown"> {
  try {
    const [origUrl, resUrl] = await Promise.all([
      resolveAccessibleUrl(originalImageUrl),
      resolveAccessibleUrl(resultImageUrl),
    ]);

    const response = await invokeLLM({
      messages: [
        { role: "system" as const, content: NOOP_JUDGE_SYSTEM_PROMPT },
        {
          role: "user" as const,
          content: [
            {
              type: "text" as const,
              text:
                `Requested change: ${expectation}\n` +
                `Image 1 is the ORIGINAL. Image 2 is the EDITED result. ` +
                `Did the edited image actually apply the requested change versus the original?`,
            },
            { type: "image_url" as const, image_url: { url: origUrl, detail: "low" as const } },
            { type: "image_url" as const, image_url: { url: resUrl, detail: "low" as const } },
          ],
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "edit_check",
          strict: true,
          schema: {
            type: "object",
            properties: {
              changed: { type: "boolean" },
              confidence: { type: "number" },
              reason: { type: "string" },
            },
            required: ["changed", "confidence", "reason"],
            additionalProperties: false,
          },
        },
      },
    });

    const raw = response.choices?.[0]?.message?.content ?? "{}";
    const content = typeof raw === "string" ? raw : JSON.stringify(raw);
    const parsed = JSON.parse(content) as { changed?: boolean; confidence?: number; reason?: string };
    // Only declare a no-op when the judge is confident the edit did NOT happen.
    if (parsed.changed === false && (parsed.confidence ?? 0) >= 0.8) {
      console.warn(`[aiEngine] No-op guard flagged unchanged output: ${parsed.reason ?? ""}`);
      return "noop";
    }
    return "applied";
  } catch (err: any) {
    // Fail open: never block a result because the judge itself failed.
    console.error(`[aiEngine] No-op guard could not evaluate result:`, err?.message || err);
    return "unknown";
  }
}

/**
 * Generate an edited image based on the instruction and original image.
 * Downloads the image server-side and passes it as base64 to avoid URL accessibility issues.
 * Returns the URL of the generated result stored in S3.
 *
 * When `expectation` is provided and the no-op guard is enabled, the result is QA-checked
 * against the original; if the requested change was not applied, it retries once and then
 * throws `NO_OP_EDIT_ERROR` so the caller can refund instead of billing for a no-op.
 *
 * Timeouts:
 * - Image download: 30 seconds
 * - Image generation API: 120 seconds (handled inside generateImage)
 */
export async function generateEditedImage(
  originalImageUrl: string,
  instruction: string,
  mimeType: string = "image/jpeg",
  expectation?: string
): Promise<string> {
  // Resolve the download URL
  let downloadUrl: string;
  if (originalImageUrl.startsWith("/manus-storage/")) {
    const key = originalImageUrl.replace("/manus-storage/", "");
    downloadUrl = await storageGetSignedUrl(key);
  } else {
    downloadUrl = originalImageUrl;
  }

  // Download and validate the image (with timeout and size check)
  const { base64: imageBase64, mimeType: resolvedMimeType } = await downloadImageAsBase64(
    downloadUrl,
    mimeType
  );

  console.log(`[aiEngine] Calling generateImage, prompt length: ${instruction.length} chars`);

  const runGeneration = () =>
    generateImage({
      prompt: instruction,
      originalImages: [{ b64Json: imageBase64, mimeType: resolvedMimeType }],
    });

  try {
    const result = await runGeneration();
    if (!result.url) {
      throw new Error("Image generation returned no URL");
    }

    // No-op guard: verify the requested change was actually applied.
    const guardActive = ENV.studioNoOpGuard && !!expectation;
    if (guardActive) {
      const verdict = await judgeEditApplied(originalImageUrl, result.url, expectation!);
      if (verdict === "noop") {
        console.warn(`[aiEngine] Edit not applied; retrying once.`);
        const retry = await runGeneration();
        if (!retry.url) {
          throw new Error("Image generation returned no URL");
        }
        const retryVerdict = await judgeEditApplied(originalImageUrl, retry.url, expectation!);
        if (retryVerdict === "noop") {
          throw new Error(
            `${NO_OP_EDIT_ERROR}: the model returned an unchanged image after retry`
          );
        }
        console.log(`[aiEngine] Retry applied the edit, result stored.`);
        return retry.url;
      }
    }

    console.log(`[aiEngine] Generation successful, result stored.`);
    return result.url;
  } catch (err: any) {
    console.error(`[aiEngine] generateImage failed:`, err?.message || err);
    throw err;
  }
}
