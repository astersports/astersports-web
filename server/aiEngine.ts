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
 * Returns the URL of the generated result.
 */
export async function generateEditedImage(
  originalImageUrl: string,
  instruction: string,
  mimeType: string = "image/jpeg"
): Promise<string> {
  // Get a publicly-accessible URL for the image
  let accessibleUrl = originalImageUrl;
  if (originalImageUrl.startsWith("/manus-storage/")) {
    const key = originalImageUrl.replace("/manus-storage/", "");
    accessibleUrl = await storageGetSignedUrl(key);
  }

  const result = await generateImage({
    prompt: instruction,
    originalImages: [
      {
        url: accessibleUrl,
        mimeType,
      },
    ],
  });

  if (!result.url) {
    throw new Error("Image generation returned no URL");
  }
  return result.url;
}
