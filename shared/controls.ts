/**
 * Shared definitions for the four print-editing controls.
 * Each percentage control supports 10% increments PLUS a custom value.
 */
import { sanitizeElementName, sanitizeColorValue } from "./sanitize";

export interface ScaleControl {
  enabled: boolean;
  /** Percentage change to object size. Negative = reduce, positive = enlarge. e.g. -30, +20. */
  percent: number;
}

export interface DensityControl {
  enabled: boolean;
  /** Percent of print to thin out evenly. 0..100. */
  percent: number;
}

export interface RemoveControl {
  enabled: boolean;
  /** Natural-language element name, e.g. "blue buds". */
  element: string;
  /** Percent of that element to remove. 0..100. */
  percent: number;
}

export interface RecolorControl {
  enabled: boolean;
  /** Natural-language element name to recolor, e.g. "pink blossoms". */
  element: string;
  /** Target color name or hex code, e.g. "coral", "deep navy", "#2A4B7C". */
  targetColor: string;
  /** Optional: coverage percentage — what percent of the selected element to recolor (default 100). */
  coverage: number;
}

export interface ControlSettings {
  scale: ScaleControl;
  density: DensityControl;
  remove: RemoveControl;
  recolor: RecolorControl;
  /** Number of variations to generate (1..4). */
  variations: number;
}

export const SCALE_MIN = -50;
export const SCALE_MAX = 50;
export const DENSITY_MIN = 0;
export const DENSITY_MAX = 90;
export const REMOVE_MIN = 0;
export const REMOVE_MAX = 100;
export const RECOLOR_COVERAGE_MIN = 10;
export const RECOLOR_COVERAGE_MAX = 100;
export const MAX_VARIATIONS = 4;

/** 10% increment steppers (custom values are still allowed via the input field). */
export const SCALE_STEPS = [-50, -40, -30, -20, -10, 0, 10, 20, 30, 40, 50];
export const PERCENT_STEPS = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

/** Curated palette of common textile recolor targets. */
export const RECOLOR_PRESETS = [
  { name: "Coral", value: "coral" },
  { name: "Deep Navy", value: "deep navy" },
  { name: "Sage Green", value: "sage green" },
  { name: "Dusty Rose", value: "dusty rose" },
  { name: "Ivory", value: "ivory" },
  { name: "Burnt Sienna", value: "burnt sienna" },
  { name: "Cobalt Blue", value: "cobalt blue" },
  { name: "Chartreuse", value: "chartreuse" },
  { name: "Mauve", value: "mauve" },
  { name: "Terracotta", value: "terracotta" },
  { name: "Midnight Black", value: "midnight black" },
  { name: "Champagne Gold", value: "champagne gold" },
] as const;

export function defaultControls(): ControlSettings {
  return {
    scale: { enabled: false, percent: 0 },
    density: { enabled: false, percent: 0 },
    remove: { enabled: false, element: "", percent: 0 },
    recolor: { enabled: false, element: "", targetColor: "", coverage: 100 },
    variations: 1,
  };
}

/**
 * System-level preamble that establishes the textile/fashion editing context.
 * Prepended to every generation instruction to anchor the model's understanding.
 * CRITICAL: Contains strong anti-rotation and anti-repositioning constraints.
 */
const TEXTILE_PREAMBLE =
  "You are a professional textile print designer performing a SURGICAL EDIT on an existing product photograph. " +
  "CRITICAL CONSTRAINTS — you MUST obey ALL of these:\n" +
  "1. DO NOT rotate, flip, reposition, or re-photograph the garment. The garment must remain in the EXACT same position, angle, and orientation as the input image.\n" +
  "2. DO NOT change the camera angle, perspective, or crop. The output must be pixel-aligned with the input for everything except the print pattern.\n" +
  "3. DO NOT lay the garment flat if it is hanging, or hang it if it is flat. Keep the EXACT same presentation.\n" +
  "4. DO NOT change the background, lighting, shadows, hanger, clips, or any non-fabric elements.\n" +
  "5. ONLY modify the printed pattern/motifs on the fabric surface. The garment silhouette, shape, drape, folds, and construction must be IDENTICAL to the input.\n" +
  "6. Preserve the base cloth color and fabric texture (woven, knit, or non-woven).\n" +
  "7. The output image must have the SAME dimensions and aspect ratio as the input.\n\n" +
  "Think of this as digitally re-printing the fabric with a modified pattern while the garment stays frozen in place.";

/**
 * Server-side instruction builder: converts control settings into a single
 * natural-language editing instruction for the image-edit model.
 * Uses textile and fashion industry terminology for precision.
 * Kept in shared so tests can import it directly.
 */
export function buildInstruction(c: ControlSettings): string {
  const parts: string[] = [];

  if (c.scale.enabled && c.scale.percent !== 0) {
    if (c.scale.percent > 0) {
      parts.push(
        `SCALE UP — MAKE EACH MOTIF PHYSICALLY LARGER:\n` +
        `Take EVERY individual motif (flower, leaf, bud, geometric shape, decorative element) and ENLARGE it by ${c.scale.percent}% ` +
        `in both width and height. Each flower that was 2cm should now be approximately ${(2 * (1 + c.scale.percent / 100)).toFixed(1)}cm.\n` +
        `WHAT THIS MEANS VISUALLY: Each individual flower/motif becomes BIGGER — takes up more physical space on the fabric. ` +
        `The motifs will appear closer together because they are larger, but do NOT change their center positions.\n` +
        `DO NOT just add more motifs. DO NOT change colors. DO NOT move motif positions. ` +
        `ONLY increase the physical dimensions of each existing motif while keeping it centered on its original location.\n` +
        `Keep all fine details (veins, petals, outlines, gradients) proportionally scaled up.`
      );
    } else {
      parts.push(
        `SCALE DOWN — MAKE EACH MOTIF PHYSICALLY SMALLER:\n` +
        `Take EVERY individual motif (flower, leaf, bud, geometric shape, decorative element) and SHRINK it by ${Math.abs(c.scale.percent)}% ` +
        `in both width and height. Each flower that was 2cm should now be approximately ${(2 * (1 - Math.abs(c.scale.percent) / 100)).toFixed(1)}cm.\n` +
        `WHAT THIS MEANS VISUALLY: Each individual flower/motif becomes SMALLER — takes up less physical space on the fabric. ` +
        `More of the background fabric color will be visible between motifs because each motif is now smaller.\n` +
        `DO NOT remove any motifs — the SAME NUMBER of motifs should remain. ` +
        `DO NOT move motif positions — each motif stays centered on its original location. ` +
        `DO NOT change colors. ONLY reduce the physical dimensions of each existing motif.\n` +
        `The freed space around each shrunken motif should show the base fabric background color. ` +
        `Keep all fine details (veins, petals, outlines, gradients) proportionally scaled down — maintain crispness.`
      );
    }
  }

  if (c.density.enabled && c.density.percent > 0) {
    parts.push(
      `DENSITY REDUCTION — DELETE ${c.density.percent}% OF ALL MOTIFS FROM THE FABRIC:\n` +
      `Count the total number of printed motifs (flowers, leaves, buds, all decorative elements) visible on the fabric. ` +
      `Then PERMANENTLY DELETE approximately ${c.density.percent}% of them by erasing them completely — ` +
      `paint over each deleted motif with the base fabric background color so it DISAPPEARS.\n` +
      `WHAT THE RESULT SHOULD LOOK LIKE: If there were originally 100 flowers, only approximately ${100 - c.density.percent} should remain. ` +
      `The fabric should look MORE SPARSE — more bare background visible, FEWER total motifs printed on it.\n` +
      `RULES FOR DELETION:\n` +
      `- Choose which motifs to delete RANDOMLY and EVENLY across the entire fabric surface (not just from one area).\n` +
      `- DO NOT move, shift, or reposition any motifs. Every surviving motif stays in its EXACT original position.\n` +
      `- DO NOT resize any surviving motifs. They stay at their original scale.\n` +
      `- DO NOT change colors of surviving motifs.\n` +
      `- DO NOT add new motifs anywhere.\n` +
      `- Where a motif was deleted, that area should show ONLY the plain background fabric color (match the color visible between existing motifs).\n` +
      `- The result must have VISIBLY FEWER motifs than the input — this is the primary visual change.`
    );
  }

  if (c.remove.enabled && c.remove.element && c.remove.percent > 0) {
    const safeRemoveElement = sanitizeElementName(c.remove.element);
    if (!safeRemoveElement) return "Return the image unchanged.";
    parts.push(
      `SELECTIVE ELEMENT REMOVAL — ERASE AND DELETE: Permanently erase approximately ${c.remove.percent}% of the "${safeRemoveElement}" motifs from the print. ` +
      `CRITICAL: "Remove" means COMPLETELY DELETE — paint over them with the base fabric background color so they VANISH entirely. ` +
      `DO NOT move, reposition, scatter, shift, or redistribute the removed motifs to other areas of the fabric. ` +
      `DO NOT push motifs to the edges, corners, or borders. ` +
      `DO NOT rearrange the remaining motifs — every surviving motif must stay in its EXACT original position. ` +
      `The removal process is: (1) Identify all instances of "${safeRemoveElement}" across the fabric. ` +
      `(2) Select approximately ${c.remove.percent}% of them, distributed evenly across the surface. ` +
      `(3) For each selected instance, ERASE it completely by filling that area with the surrounding base cloth ground color ` +
      `(the fabric's background — in this case, match the exact background color visible between existing motifs). ` +
      `(4) Blend the erased area seamlessly so it looks like bare fabric — as if the motif was never printed there. ` +
      `The remaining ${100 - c.remove.percent}% of "${safeRemoveElement}" motifs stay EXACTLY where they are — same position, same scale, same color. ` +
      `All other print elements (companion florals, foliage, geometric fillers, accent dots, trailing vines, ` +
      `border motifs, and ground textures) remain completely untouched in position, scale, and color. ` +
      `The result should have FEWER total motifs visible — more empty/bare fabric showing — NOT the same number of motifs rearranged. ` +
      `The garment construction, fabric hand, and photographic setting are unchanged.`
    );
  }

  if (c.recolor.enabled && c.recolor.element && c.recolor.targetColor) {
    const safeRecolorElement = sanitizeElementName(c.recolor.element);
    const safeTargetColor = sanitizeColorValue(c.recolor.targetColor);
    if (!safeRecolorElement || !safeTargetColor) return "Return the image unchanged.";
    const coverageText = c.recolor.coverage < 100
      ? `approximately ${c.recolor.coverage}% of`
      : "all";
    parts.push(
      `COLORWAY SHIFT: Recolor ${coverageText} the "${safeRecolorElement}" motifs to "${safeTargetColor}". ` +
      `Apply the new colorway as a professional dye-lot change — shift the hue, saturation, and value ` +
      `of the targeted motifs while preserving their internal tonal gradients, shading, highlights, and texture detail. ` +
      `The recolored motifs should look as if they were originally printed in the target color, ` +
      `not as if a flat color overlay was applied. Maintain natural color variation within each motif ` +
      `(lighter petal edges, darker shadow areas, vein details) transposed into the new colorway. ` +
      `All other print elements retain their original colors exactly. ` +
      `The base cloth ground color, garment construction, and photographic setting remain unchanged.`
    );
  }

  if (parts.length === 0) {
    return "Return the image unchanged.";
  }

  return (
    TEXTILE_PREAMBLE +
    "\n\n" +
    parts.join("\n\n") +
    "\n\nOUTPUT REQUIREMENTS:\n" +
    "- The output MUST be the same image with ONLY the print pattern modified.\n" +
    "- The garment must be in the EXACT same position and orientation — NOT rotated, NOT repositioned, NOT re-photographed.\n" +
    "- Same resolution, same aspect ratio, same camera angle, same background.\n" +
    "- Same lighting, white balance, and shadow placement.\n" +
    "- The hanger, clips, mannequin, or surface must remain pixel-identical.\n" +
    "- No watermarks, text overlays, or border artifacts.\n" +
    "- If you cannot perform the edit without moving the garment, return the image unchanged rather than rotating it."
  );
}

/** How many credits a given control settings job will consume. */
export function computeCredits(
  c: ControlSettings,
  costs: { standardGeneration: number; extraVariation: number; combinedControls: number }
): number {
  const activeControls = [
    c.scale.enabled,
    c.density.enabled,
    c.remove.enabled,
    c.recolor.enabled,
  ].filter(Boolean).length;
  if (activeControls === 0) return 0;
  const base = activeControls > 1 ? costs.combinedControls : costs.standardGeneration;
  const extra = Math.max(0, c.variations - 1) * costs.extraVariation;
  return base + extra;
}
