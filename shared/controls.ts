/**
 * Shared definitions for the two print-editing controls: SCALE and DENSITY.
 * (recolor and remove were retired in the two-op reduction.)
 * Each percentage control supports 10% increments PLUS a custom value.
 */

export interface ScaleControl {
  enabled: boolean;
  /** Percentage change to object size. Negative = reduce, positive = enlarge. e.g. -30, +20. */
  percent: number;
}

/**
 * How surviving motifs are arranged after thinning:
 *  - "respace": RELOCATE survivors to an even (blue-noise) layout. Best for repeating
 *    all-over prints (ditsy florals, terrazzo) — evens out the spacing.
 *  - "inplace": keep every survivor in its ORIGINAL position. Best for placed / couture
 *    designs — preserves the composition (readable text, deliberate placement) and never
 *    moves a motif off-garment.
 */
export type DensityMode = "respace" | "inplace";

export interface DensityControl {
  enabled: boolean;
  /** Percent of print to thin out evenly. 0..100. */
  percent: number;
  /** Layout of survivors after thinning. Optional for back-compat (absent -> server
   *  falls back to the STUDIO_DENSITY_REDISTRIBUTE flag default). */
  mode?: DensityMode;
}

/**
 * Resolve whether density runs v2 (respace/relocate) vs v1 (thin in place), HONOURING
 * the STUDIO_DENSITY_REDISTRIBUTE flip-authority flag as a ceiling: respace only runs
 * when the user asked for it AND the flag is live. An absent mode (old jobs) falls back
 * to the flag's prior env-driven behaviour. v1 (in place) is always a safe result.
 */
export function resolveDensityRedistribute(
  mode: DensityMode | undefined,
  envRedistributeLive: boolean
): boolean {
  const wantRespace = mode != null ? mode === "respace" : envRedistributeLive;
  return wantRespace && envRedistributeLive;
}

export interface ControlSettings {
  scale: ScaleControl;
  density: DensityControl;
  /** Number of variations to generate (1..4). */
  variations: number;
}

export const SCALE_MIN = -50;
export const SCALE_MAX = 100;
export const DENSITY_MIN = 0;
export const DENSITY_MAX = 90;
export const MAX_VARIATIONS = 4;

/** 10% increment steppers (custom values are still allowed via the input field). */
export const SCALE_STEPS = [-50, -40, -30, -20, -10, 0, 10, 20, 30, 40, 50];
export const PERCENT_STEPS = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

export function defaultControls(): ControlSettings {
  return {
    scale: { enabled: false, percent: 0 },
    density: { enabled: false, percent: 0, mode: "inplace" },
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
 * natural-language editing instruction for the image-edit model (generative
 * fallback path). Kept in shared so tests can import it directly.
 */
export function buildInstruction(c: ControlSettings): string {
  const parts: string[] = [];

  if (c.scale.enabled && c.scale.percent !== 0) {
    if (c.scale.percent > 0) {
      // Describe scale-up using textile print terminology
      const scaleUpDescriptor = c.scale.percent >= 40
        ? "dramatically oversized, jumbo-scale"
        : c.scale.percent >= 20
        ? "noticeably larger, bold-scale"
        : "slightly enlarged";
      parts.push(
        `PRINT SCALE CHANGE — ENLARGE THE MOTIF REPEAT:\n` +
        `Redraw the entire surface print at a LARGER repeat scale. Every printed motif (flowers, leaves, buds, shapes) ` +
        `must be redrawn ${scaleUpDescriptor} — each motif should occupy approximately ${100 + c.scale.percent}% of its current area on the fabric.\n` +
        `VISUAL REFERENCE: Imagine the original print was photographed through a magnifying glass at ${100 + c.scale.percent}% zoom — ` +
        `that is how large each individual flower/motif should appear. The motifs become CHUNKIER and BOLDER, ` +
        `filling more of the fabric surface. Gaps between motifs become SMALLER because each motif is bigger.\n` +
        `CRITICAL RULES:\n` +
        `- Every motif must be visibly BIGGER than in the input image — this is the #1 requirement.\n` +
        `- Keep the same number of motifs (do not add extras).\n` +
        `- Keep the same colors, style, and artistic treatment.\n` +
        `- Keep motifs in approximately the same positions (center points unchanged).\n` +
        `- The result should look like the SAME print design but at a LARGER scale — as if the textile mill enlarged the screen/roller.`
      );
    } else {
      // Describe scale-down using textile print terminology
      const absPercent = Math.abs(c.scale.percent);
      const scaleDownDescriptor = absPercent >= 40
        ? "tiny, miniature ditsy-scale"
        : absPercent >= 20
        ? "noticeably smaller, petite-scale"
        : "slightly reduced";
      const remainingScale = 100 - absPercent;
      parts.push(
        `PRINT SCALE CHANGE — SHRINK THE MOTIF REPEAT:\n` +
        `Redraw the entire surface print at a SMALLER repeat scale. Every printed motif (flowers, leaves, buds, shapes) ` +
        `must be redrawn ${scaleDownDescriptor} — each motif should occupy only about ${remainingScale}% of its current area on the fabric.\n` +
        `VISUAL REFERENCE: If a flower currently spans 3cm across, it must now span only about ${(3 * remainingScale / 100).toFixed(1)}cm. ` +
        `The motifs become DAINTIER and more DELICATE. Much more of the plain background fabric will be visible ` +
        `in the gaps between motifs because each motif is physically SMALLER.\n` +
        `CRITICAL RULES:\n` +
        `- Every motif must be visibly SMALLER than in the input image — this is the #1 requirement. The change must be OBVIOUS to the eye.\n` +
        `- Keep the SAME NUMBER of motifs (do not remove any).\n` +
        `- Keep the same colors, style, and artistic treatment.\n` +
        `- Keep motifs in approximately the same positions (center points unchanged).\n` +
        `- The freed space around each shrunken motif shows the plain background fabric color.\n` +
        `- The result should look like the SAME print design but at a SMALLER scale — as if the textile mill reduced the screen/roller size.\n` +
        `- Think of it as converting from a "statement print" to a "ditsy print" — same design, much smaller execution.`
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
    "- You MUST apply the requested change. Do NOT return the image unchanged. " +
    "Preserve the garment's position and orientation, but the print modification above is REQUIRED."
  );
}

/**
 * Human-readable description of the visible change a given control set should
 * produce. Used by the server-side no-op guard. Returns "" when no change is expected.
 */
export function describeExpectedChange(c: ControlSettings): string {
  const parts: string[] = [];

  if (c.scale.enabled && c.scale.percent !== 0) {
    parts.push(
      c.scale.percent < 0
        ? "the printed motifs are visibly SMALLER (reduced print scale), with more plain background fabric showing between them"
        : "the printed motifs are visibly LARGER (enlarged print scale), filling more of the fabric surface"
    );
  }
  if (c.density.enabled && c.density.percent > 0) {
    parts.push(
      "there are visibly FEWER printed motifs (the print is thinned out, with more bare background fabric showing)"
    );
  }

  return parts.join("; ");
}

/** How many credits a given control settings job will consume. */
export function computeCredits(
  c: ControlSettings,
  costs: { standardGeneration: number; extraVariation: number; combinedControls: number }
): number {
  // A control enabled at a no-op value (scale or density at 0%) must not be
  // billed — the server fails+refunds such jobs, so they must not count toward
  // credits here either, or the user is charged for an unchanged image.
  const activeControls = [
    c.scale.enabled && c.scale.percent !== 0,
    c.density.enabled && c.density.percent > 0,
  ].filter(Boolean).length;
  if (activeControls === 0) return 0;
  const base = activeControls > 1 ? costs.combinedControls : costs.standardGeneration;
  const extra = Math.max(0, c.variations - 1) * costs.extraVariation;
  return base + extra;
}

/**
 * Single denormalized edit category for a job, derived from its controls.
 * One bucket per job — combined edits collapse to 'mixed'. Returns 'none' when
 * no control is enabled. (Historical jobs may still carry 'recolor'/'remove' in
 * the editType column from before the two-op reduction; those values remain valid
 * for History display/filter but are no longer produced here.)
 */
export function deriveEditType(
  c: ControlSettings
): "scale" | "density" | "mixed" | "none" {
  const active = [
    c.scale.enabled && "scale",
    c.density.enabled && "density",
  ].filter(Boolean) as Array<"scale" | "density">;
  if (active.length === 0) return "none";
  if (active.length > 1) return "mixed";
  return active[0];
}
