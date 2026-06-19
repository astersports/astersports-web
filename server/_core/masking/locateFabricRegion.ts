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
  "axis-aligned bounding box of the FLATTEST, most frontal, least-folded region " +
  "of PRINTED FABRIC — the area best suited to sample the print's repeat. Avoid " +
  "seams, edges, deep shadow, the hanger/mannequin, and the photographic background. " +
  "Coordinates are normalized 0..1 (x,y = top-left; w,h = size). Give an honest confidence.";

/** Center-crop fallback used when the locator can't be parsed. */
const DEFAULT_REGION: FabricRegionResult = {
  bbox: { x: 0.3, y: 0.3, w: 0.4, h: 0.4 },
  confidence: 0,
};

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

    return {
      bbox: { x: clamp01(p.x), y: clamp01(p.y), w, h },
      confidence: clamp01(p.confidence),
    };
  } catch (err: any) {
    console.error(`[masking] locateFabricRegion failed, using center-crop:`, err?.message || err);
    return DEFAULT_REGION;
  }
}
