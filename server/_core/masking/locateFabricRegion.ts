/**
 * Vision-LLM bounding-box locator for the printed-fabric region.
 *
 * This is the "box" half of the box->mask hybrid (Amendment 1 §13.3). It works
 * today with no new dependency — it reuses the existing `invokeLLM`. A
 * raster-capable provider (classical GrabCut or SAM 2) later refines this box
 * into a precise pixel mask.
 *
 * SAFEGUARDS (density subsection fix):
 *  1. Separate density-specific locator (`locateFabricRegionForDensity`) that
 *     uses a full-garment prompt — never the "best sample region" prompt.
 *  2. Minimum area threshold: if the LLM returns < MIN_AREA_FRACTION coverage,
 *     auto-expand to the full-garment default.
 *  3. Bbox expansion: 5% padding on each side to catch edge motifs.
 *  4. Bbox logging: every call logs the returned bbox for production audit.
 */
import { invokeLLM } from "../llm";
import { storageGetSignedUrl } from "../../storage";
import type { BBoxNormalized } from "./types";

export interface FabricRegionResult {
  bbox: BBoxNormalized;
  confidence: number;
}

// ─── PROMPTS ────────────────────────────────────────────────────────────────

/**
 * Default prompt: used by recolor/scale — finds the ENTIRE visible printed
 * fabric area (updated from the old "best sample" prompt).
 */
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

/**
 * Density-specific prompt: even more aggressive about full coverage.
 * Explicitly instructs the LLM that this is for density reduction (motif removal)
 * and that missing any area means those motifs won't be processed.
 */
const DENSITY_SYSTEM_PROMPT =
  "You are a textile-print vision analyst performing DENSITY REDUCTION analysis. " +
  "Given a garment photo, return the axis-aligned bounding box that covers the MAXIMUM " +
  "possible area of printed fabric on the garment. " +
  "CRITICAL: Any motif/pattern element OUTSIDE this box will NOT be processed for density " +
  "reduction, creating an uneven result. You MUST include ALL of the following: " +
  "- The entire front panel from neckline to hem " +
  "- Both sleeves fully (from shoulder seam to cuff) " +
  "- Collar/neckline area if it has print " +
  "- Side panels and any visible back panel " +
  "- Hem/bottom edge of the garment " +
  "The box should be as LARGE as possible while still excluding the photographic background. " +
  "It is MUCH better to include 5-10% of background than to miss ANY printed fabric. " +
  "If in doubt, make the box BIGGER. " +
  "Coordinates are normalized 0..1 (x,y = top-left; w,h = size). Give an honest confidence.";

// ─── CONSTANTS ──────────────────────────────────────────────────────────────

/** Full-garment fallback used when the locator can't be parsed or area is too small. */
const DEFAULT_REGION: FabricRegionResult = {
  bbox: { x: 0.05, y: 0.05, w: 0.9, h: 0.9 },
  confidence: 0,
};

/**
 * Minimum area fraction (w × h) the LLM must return. If below this, the bbox
 * is considered "too tight" (likely only a subsection) and we auto-expand to
 * the full-garment default. 0.35 = 35% of the image area.
 */
const MIN_AREA_FRACTION = 0.35;

/**
 * Expand a bbox by a relative padding factor on each side, clamped to [0,1].
 * This ensures the fabric region covers the full garment even if the LLM
 * returns a slightly tight box.
 */
const EXPANSION_FACTOR = 0.05; // 5% padding on each side
export function expandBbox(bbox: BBoxNormalized): BBoxNormalized {
  const padX = bbox.w * EXPANSION_FACTOR;
  const padY = bbox.h * EXPANSION_FACTOR;
  const x = Math.max(0, bbox.x - padX);
  const y = Math.max(0, bbox.y - padY);
  const w = Math.min(1 - x, bbox.w + 2 * padX);
  const h = Math.min(1 - y, bbox.h + 2 * padY);
  return { x, y, w, h };
}

// ─── HELPERS ────────────────────────────────────────────────────────────────

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

// ─── CORE LOCATOR ───────────────────────────────────────────────────────────

async function callVisionLLM(imageUrl: string, systemPrompt: string): Promise<FabricRegionResult> {
  const url = await resolveAccessibleUrl(imageUrl);
  const response = await invokeLLM({
    messages: [
      { role: "system" as const, content: systemPrompt },
      {
        role: "user" as const,
        content: [
          {
            type: "text" as const,
            text: "Return the bounding box that covers ALL printed fabric on this garment.",
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
    bbox: rawBbox,
    confidence: clamp01(p.confidence),
  };
}

// ─── PUBLIC API ─────────────────────────────────────────────────────────────

/**
 * Standard fabric region locator (used by recolor, scale, and general ops).
 * Applies expansion + minimum area safeguard.
 */
export async function locateFabricRegion(imageUrl: string): Promise<FabricRegionResult> {
  try {
    const result = await callVisionLLM(imageUrl, SYSTEM_PROMPT);

    // SAFEGUARD 2: Minimum area threshold
    const area = result.bbox.w * result.bbox.h;
    if (area < MIN_AREA_FRACTION) {
      console.warn(
        `[masking] locateFabricRegion: bbox area ${(area * 100).toFixed(1)}% < ${(MIN_AREA_FRACTION * 100).toFixed(0)}% threshold. ` +
        `LLM returned {x:${result.bbox.x.toFixed(3)}, y:${result.bbox.y.toFixed(3)}, w:${result.bbox.w.toFixed(3)}, h:${result.bbox.h.toFixed(3)}}. ` +
        `Auto-expanding to full-garment default.`
      );
      return DEFAULT_REGION;
    }

    // SAFEGUARD 3: Expansion (5% padding)
    const expanded = expandBbox(result.bbox);

    // SAFEGUARD 4: Bbox logging for production audit
    console.log(
      `[masking] locateFabricRegion: bbox={x:${expanded.x.toFixed(3)}, y:${expanded.y.toFixed(3)}, ` +
      `w:${expanded.w.toFixed(3)}, h:${expanded.h.toFixed(3)}} area=${(expanded.w * expanded.h * 100).toFixed(1)}% ` +
      `confidence=${result.confidence.toFixed(2)}`
    );

    return { bbox: expanded, confidence: result.confidence };
  } catch (err: any) {
    console.error(`[masking] locateFabricRegion failed, using full-garment default:`, err?.message || err);
    return DEFAULT_REGION;
  }
}

/**
 * SAFEGUARD 1: Density-specific locator.
 * Uses a more aggressive prompt that emphasizes full coverage and explicitly
 * warns the LLM that missed areas won't be processed. Also applies stricter
 * minimum area threshold and expansion.
 *
 * This should be called by the density pipeline instead of `locateFabricRegion`.
 */
export async function locateFabricRegionForDensity(imageUrl: string): Promise<FabricRegionResult> {
  try {
    const result = await callVisionLLM(imageUrl, DENSITY_SYSTEM_PROMPT);

    // Stricter minimum area for density: 40% (density MUST cover the full garment)
    const DENSITY_MIN_AREA = 0.40;
    const area = result.bbox.w * result.bbox.h;
    if (area < DENSITY_MIN_AREA) {
      console.warn(
        `[masking] locateFabricRegionForDensity: bbox area ${(area * 100).toFixed(1)}% < ${(DENSITY_MIN_AREA * 100).toFixed(0)}% threshold. ` +
        `LLM returned {x:${result.bbox.x.toFixed(3)}, y:${result.bbox.y.toFixed(3)}, w:${result.bbox.w.toFixed(3)}, h:${result.bbox.h.toFixed(3)}}. ` +
        `Auto-expanding to full-garment default.`
      );
      return DEFAULT_REGION;
    }

    // Expansion (5% padding)
    const expanded = expandBbox(result.bbox);

    // Bbox logging for production audit
    console.log(
      `[masking] locateFabricRegionForDensity: bbox={x:${expanded.x.toFixed(3)}, y:${expanded.y.toFixed(3)}, ` +
      `w:${expanded.w.toFixed(3)}, h:${expanded.h.toFixed(3)}} area=${(expanded.w * expanded.h * 100).toFixed(1)}% ` +
      `confidence=${result.confidence.toFixed(2)}`
    );

    return { bbox: expanded, confidence: result.confidence };
  } catch (err: any) {
    console.error(`[masking] locateFabricRegionForDensity failed, using full-garment default:`, err?.message || err);
    return DEFAULT_REGION;
  }
}

/**
 * SAFEGUARD 3 (instance count): Validates that the number of detected instances
 * is reasonable for a density operation. If too few instances are detected on
 * what should be a dense print, logs a warning. This is called by the density
 * pipeline AFTER segmentation.
 *
 * Returns { valid: true } if the count is acceptable, or { valid: false, reason }
 * if it's suspiciously low (caller decides whether to retry or proceed).
 */
export const MIN_DENSITY_INSTANCES = 5;

export function validateInstanceCount(
  instanceCount: number,
  bboxArea: number
): { valid: boolean; reason?: string } {
  if (instanceCount === 0) {
    return { valid: false, reason: "SAM2 detected 0 instances — likely a segmentation failure or non-patterned fabric." };
  }
  if (instanceCount < MIN_DENSITY_INSTANCES && bboxArea > 0.5) {
    // Large bbox but very few instances — suspicious. Could mean SAM2 merged
    // many motifs into one large segment, or the crop missed most of the pattern.
    return {
      valid: false,
      reason: `Only ${instanceCount} instances detected in a large fabric area (${(bboxArea * 100).toFixed(0)}%). ` +
        `Expected at least ${MIN_DENSITY_INSTANCES} for a patterned garment. SAM2 may have under-segmented.`,
    };
  }
  return { valid: true };
}
