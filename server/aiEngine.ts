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

/**
 * Generate an edited image based on the instruction and original image.
 * Downloads the image server-side and passes it as base64 to avoid URL accessibility issues.
 * Returns the URL of the generated result stored in S3.
 *
 * Timeouts:
 * - Image download: 30 seconds
 * - Image generation API: 120 seconds (handled inside generateImage)
 */
export async function generateEditedImage(
  originalImageUrl: string,
  instruction: string,
  mimeType: string = "image/jpeg"
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

  try {
    const result = await generateImage({
      prompt: instruction,
      originalImages: [
        {
          b64Json: imageBase64,
          mimeType: resolvedMimeType,
        },
      ],
    });

    if (!result.url) {
      throw new Error("Image generation returned no URL");
    }
    console.log(`[aiEngine] Generation successful, result stored.`);
    return result.url;
  } catch (err: any) {
    console.error(`[aiEngine] generateImage failed:`, err?.message || err);
    throw err;
  }
}
