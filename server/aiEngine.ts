/**
 * AI Engine for Print Studio.
 * Handles element detection (via LLM vision) and image editing (via generateImage).
 * Uses textile and fashion industry terminology for precision.
 */
import { invokeLLM } from "./_core/llm";
import { generateImage } from "./_core/imageGeneration";
import { storageGetSignedUrl } from "./storage";

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
 * Generate an edited image based on the instruction and original image.
 * Downloads the image server-side and passes it as base64 to avoid URL accessibility issues.
 * Returns the URL of the generated result.
 */
export async function generateEditedImage(
  originalImageUrl: string,
  instruction: string,
  mimeType: string = "image/jpeg"
): Promise<string> {
  // Download the image and convert to base64
  let imageBase64: string;
  let resolvedMimeType = mimeType;

  if (originalImageUrl.startsWith("/manus-storage/")) {
    const key = originalImageUrl.replace("/manus-storage/", "");
    console.log(`[aiEngine] Resolving signed URL for key: ${key}`);
    const signedUrl = await storageGetSignedUrl(key);
    console.log(`[aiEngine] Downloading image from signed URL...`);
    const response = await fetch(signedUrl);
    if (!response.ok) {
      throw new Error(`Failed to download image: ${response.status} ${response.statusText}`);
    }
    const contentType = response.headers.get("content-type");
    if (contentType) resolvedMimeType = contentType;
    const buffer = Buffer.from(await response.arrayBuffer());
    imageBase64 = buffer.toString("base64");
    console.log(`[aiEngine] Image downloaded, size: ${buffer.length} bytes, mime: ${resolvedMimeType}`);
  } else {
    // External URL — download it
    console.log(`[aiEngine] Downloading image from external URL...`);
    const response = await fetch(originalImageUrl);
    if (!response.ok) {
      throw new Error(`Failed to download image: ${response.status} ${response.statusText}`);
    }
    const contentType = response.headers.get("content-type");
    if (contentType) resolvedMimeType = contentType;
    const buffer = Buffer.from(await response.arrayBuffer());
    imageBase64 = buffer.toString("base64");
    console.log(`[aiEngine] Image downloaded, size: ${buffer.length} bytes, mime: ${resolvedMimeType}`);
  }

  console.log(`[aiEngine] Calling generateImage with prompt length: ${instruction.length}`);

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
    console.log(`[aiEngine] Generation successful, result URL: ${result.url}`);
    return result.url;
  } catch (err: any) {
    console.error(`[aiEngine] generateImage failed:`, err?.message || err);
    throw err;
  }
}
