/**
 * Shared definitions for the three print-editing controls.
 * Each percentage control supports 10% increments PLUS a custom value.
 */

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

export interface ControlSettings {
  scale: ScaleControl;
  density: DensityControl;
  remove: RemoveControl;
  /** Number of variations to generate (1..4). */
  variations: number;
}

export const SCALE_MIN = -50;
export const SCALE_MAX = 50;
export const DENSITY_MIN = 0;
export const DENSITY_MAX = 90;
export const REMOVE_MIN = 0;
export const REMOVE_MAX = 100;
export const MAX_VARIATIONS = 4;

/** 10% increment steppers (custom values are still allowed via the input field). */
export const SCALE_STEPS = [-50, -40, -30, -20, -10, 0, 10, 20, 30, 40, 50];
export const PERCENT_STEPS = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

export function defaultControls(): ControlSettings {
  return {
    scale: { enabled: false, percent: 0 },
    density: { enabled: false, percent: 0 },
    remove: { enabled: false, element: "", percent: 0 },
    variations: 1,
  };
}

/**
 * System-level preamble that establishes the textile/fashion editing context.
 * Prepended to every generation instruction to anchor the model's understanding.
 */
const TEXTILE_PREAMBLE =
  "You are a professional textile print designer editing a flat-lay product photograph of a printed garment. " +
  "Treat the fabric surface as a repeating or placed print layout. " +
  "Maintain the garment silhouette, construction details (seams, hems, closures), fabric drape, and photographic studio lighting throughout. " +
  "Preserve the base cloth color and hand-feel appearance (woven, knit, or non-woven texture). " +
  "All edits apply exclusively to the surface print/pattern — never alter the garment cut, fit, or styling.";

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
        `SCALE UP: Uniformly enlarge every motif in the repeat by approximately ${c.scale.percent}%. ` +
        `Increase the motif footprint proportionally — enlarge each floral head, leaf cluster, geometric unit, or decorative element ` +
        `while maintaining the original colorway, motif spacing rhythm, and half-drop or block repeat structure. ` +
        `The overall print density (motifs per square inch) should decrease slightly as each motif occupies more ground area. ` +
        `Keep stroke weights and fine interior details (veins, stippling, outlines) proportionally scaled.`
      );
    } else {
      parts.push(
        `SCALE DOWN: Uniformly reduce every motif in the repeat by approximately ${Math.abs(c.scale.percent)}%. ` +
        `Shrink each floral head, leaf cluster, geometric unit, or decorative element proportionally ` +
        `while maintaining the original colorway, motif spacing rhythm, and repeat structure. ` +
        `The overall print density (motifs per square inch) should increase slightly as each motif occupies less ground area. ` +
        `Maintain crisp edges and fine interior details (veins, stippling, outlines) at the reduced scale. ` +
        `Fill the freed negative space with the base cloth ground color — do not stretch or duplicate motifs.`
      );
    }
  }

  if (c.density.enabled && c.density.percent > 0) {
    parts.push(
      `DENSITY REDUCTION: Thin out the print coverage by removing approximately ${c.density.percent}% of the motifs ` +
      `evenly distributed across the fabric ground. Select motifs for removal using a stochastic scatter — ` +
      `avoid creating obvious gaps, bald patches, or directional bias. ` +
      `The remaining motifs stay at their original scale, color saturation, and placement coordinates. ` +
      `Exposed areas reveal the base cloth ground color (the fabric's dyed or greige background). ` +
      `Maintain the overall visual balance and rhythm of the repeat — the result should read as a ` +
      `lighter, more open version of the same print design, not a damaged or incomplete pattern. ` +
      `Do not shift, rotate, or recolor any surviving motifs.`
    );
  }

  if (c.remove.enabled && c.remove.element && c.remove.percent > 0) {
    parts.push(
      `SELECTIVE ELEMENT REMOVAL: Remove approximately ${c.remove.percent}% of the "${c.remove.element}" motifs from the print, ` +
      `distributed evenly across the fabric surface to avoid clustering or patchiness. ` +
      `Replace each removed instance with the surrounding base cloth ground color, seamlessly blending ` +
      `into the negative space as if the motif was never part of the original print strike-off. ` +
      `All other print elements (companion florals, foliage, geometric fillers, accent dots, trailing vines, ` +
      `border motifs, and ground textures) remain completely untouched in position, scale, and color. ` +
      `The garment construction, fabric hand, and photographic setting are unchanged.`
    );
  }

  if (parts.length === 0) {
    return "Return the image unchanged.";
  }

  return (
    TEXTILE_PREAMBLE +
    "\n\n" +
    parts.join("\n\n") +
    "\n\n" +
    "OUTPUT REQUIREMENTS: Produce a photorealistic edited product photograph at the same resolution and aspect ratio. " +
    "Match the original studio lighting, white balance, and shadow placement. " +
    "The hanger, clips, mannequin, or lay-flat surface must remain identical. " +
    "No watermarks, text overlays, or border artifacts."
  );
}

/** How many credits a given control settings job will consume. */
export function computeCredits(
  c: ControlSettings,
  costs: { standardGeneration: number; extraVariation: number; combinedControls: number }
): number {
  const activeControls = [c.scale.enabled, c.density.enabled, c.remove.enabled].filter(Boolean).length;
  if (activeControls === 0) return 0;
  const base = activeControls > 1 ? costs.combinedControls : costs.standardGeneration;
  const extra = Math.max(0, c.variations - 1) * costs.extraVariation;
  return base + extra;
}
