/**
 * Vision-LLM bounding-box locator for the printed-fabric region.
 *
 * This is the "box" half of the box->mask hybrid (Amendment 1 §13.3). It works
 * today with no new dependency — it reuses the existing `invokeLLM`. A
 * raster-capable provider (classical GrabCut or SAM 2) later refines this box
 * into a precise pixel mask.
 */
import { invokeLLM } from "../llm";
import { storageGetSignedUrl } from "../../storage";
import type { BBoxNormalized } from "./types";

export interface FabricRegionResult {
  bbox: BBoxNormalized;
  confidence: number;
}

const SYSTEM_PROMPT =
  "You are a textile-print vision analyst. Given a garment photo, return the " +
  "axis-aligned bounding box that FULLY ENCLOSES ALL visible printed fabric on the garment. " +
  "The box must cover the ENTIRE garment surface where print/pattern is visible — " +
  "from the topmost printed area to the bottommost, and from the leftmost to the rightmost. " +
  "Include ALL panels (front, sleeves, collar, hem) that show printed pattern. " +
  "The goal is to capture EVERY motif/element on the fabric so that density operations " +
  "apply uniformly across the whole garment, not just a subsection. " +
  "Exclude only the photographic background, hanger/mannequin hardware, and any non-fabric areas. " +
  "Err on the side of a LARGER box — it is better to include a small margin of background " +
  "than to miss printed fabric at the edges. " +
  "Coordinates are normalized 0..1 (x,y = top-left; w,h = size). Give an honest confidence.";

/** Full-garment fallback used when the locator can't be parsed. */
const DEFAULT_REGION: FabricRegionResult = {
  bbox: { x: 0.05, y: 0.05, w: 0.9, h: 0.9 },
  confidence: 0,
};

/**
 * Expand a bbox by a relative padding factor on each side, clamped to [0,1].
 * This ensures the fabric region covers the full garment even if the LLM
 * returns a slightly tight box.
 */
const EXPANSION_FACTOR = 0.05; // 5% padding on each side
function expandBbox(bbox: BBoxNormalized): BBoxNormalized {
  const padX = bbox.w * EXPANSION_FACTOR;
  const padY = bbox.h * EXPANSION_FACTOR;
  const x = Math.max(0, bbox.x - padX);
  const y = Math.max(0, bbox.y - padY);
  const w = Math.min(1 - x, bbox.w + 2 * padX);
  const h = Math.min(1 - y, bbox.h + 2 * padY);
  return { x, y, w, h };
}

const clamp01 = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;
};

async function resolveAccessibleUrl(url: string): Promise<string> {
  if (url.startsWith("/manus-storage/")) {
    return storageGetSignedUrl(url.replace("/manus-storage/", ""));
  }
  return url;
}

export async function locateFabricRegion(imageUrl: string): Promise<FabricRegionResult> {
  try {
    const url = await resolveAccessibleUrl(imageUrl);
    const response = await invokeLLM({
      messages: [
        { role: "system" as const, content: SYSTEM_PROMPT },
        {
          role: "user" as const,
          content: [
            {
              type: "text" as const,
              text: "Return the bounding box of the best printed-fabric region to sample.",
            },
            { type: "image_url" as const, image_url: { url, detail: "low" as const } },
          ],
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "fabric_region",
          strict: true,
          schema: {
            type: "object",
            properties: {
              x: { type: "number" },
              y: { type: "number" },
              w: { type: "number" },
              h: { type: "number" },
              confidence: { type: "number" },
            },
            required: ["x", "y", "w", "h", "confidence"],
            additionalProperties: false,
          },
        },
      },
    });

    const raw = response.choices?.[0]?.message?.content ?? "{}";
    const content = typeof raw === "string" ? raw : JSON.stringify(raw);
    const p = JSON.parse(content) as Record<string, unknown>;

    // A zero-area box is unusable — fall back rather than divide by zero downstream.
    const w = clamp01(p.w);
    const h = clamp01(p.h);
    if (w <= 0 || h <= 0) return DEFAULT_REGION;

    const rawBbox = { x: clamp01(p.x), y: clamp01(p.y), w, h };
    return {
      bbox: expandBbox(rawBbox),
      confidence: clamp01(p.confidence),
    };
  } catch (err: any) {
    console.error(`[masking] locateFabricRegion failed, using center-crop:`, err?.message || err);
    return DEFAULT_REGION;
  }
}
