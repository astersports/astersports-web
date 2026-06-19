/**
 * AI Engine for Print Studio.
 * Handles element detection (via LLM vision) and image editing (via generateImage).
 */
import { invokeLLM } from "./_core/llm";
import { generateImage } from "./_core/imageGeneration";
import { storageGetSignedUrl } from "./storage";

/**
 * Detect natural-language element names from a garment print image.
 * Uses vision LLM to identify distinct motifs/elements in the fabric print.
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
        content: `You are an expert textile analyst. Given a photo of a printed garment, identify all distinct visual elements/motifs in the fabric print. Return ONLY a JSON array of short natural-language element names (2-4 words each). Examples: "pink blossoms", "blue buds", "green leaves", "gold dots", "black swirls". Focus on the print/pattern elements, not the garment itself. Return 3-10 elements. Output ONLY the JSON array, no other text.`,
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
            text: "Identify all distinct print elements/motifs in this fabric print.",
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
              description: "Array of element names found in the print",
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
