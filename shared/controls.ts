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
 * Server-side instruction builder: converts control settings into a single
 * natural-language editing instruction for the image-edit model.
 * Kept in shared so tests can import it directly.
 */
export function buildInstruction(c: ControlSettings): string {
  const parts: string[] = [];

  if (c.scale.enabled && c.scale.percent !== 0) {
    if (c.scale.percent > 0) {
      parts.push(
        `Enlarge every printed motif/object in the fabric print evenly by approximately ${c.scale.percent}%, keeping the same garment shape, fabric, colors, and layout. Scale only the print elements uniformly across the whole pattern.`
      );
    } else {
      parts.push(
        `Reduce the size of every printed motif/object in the fabric print evenly by approximately ${Math.abs(
          c.scale.percent
        )}%, keeping the same garment shape, fabric, colors, and layout. Scale only the print elements uniformly across the whole pattern.`
      );
    }
  }

  if (c.density.enabled && c.density.percent > 0) {
    parts.push(
      `Reduce the overall density of the print evenly by approximately ${c.density.percent}%, removing motifs uniformly so there is more open negative space between them. Keep the remaining motifs at the same size and color; do not change the garment or background fabric color.`
    );
  }

  if (c.remove.enabled && c.remove.element && c.remove.percent > 0) {
    parts.push(
      `Selectively remove approximately ${c.remove.percent}% of the "${c.remove.element}" elements from the print, distributed evenly across the garment. Leave all other motifs, the garment shape, fabric, and colors unchanged.`
    );
  }

  if (parts.length === 0) {
    return "Return the image unchanged.";
  }

  return (
    "You are editing a flat product photo of a printed garment. " +
    parts.join(" ") +
    " Preserve the photographic look, lighting, hanger, and setting. Output a realistic edited photo of the same garment."
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
