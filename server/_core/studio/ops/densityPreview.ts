/**
 * Density PREVIEW (Phase 1). Produces the 10/20/50% preview Frank wants on the
 * client's SCATTERED all-over prints (the strategy-doc §4 P1 deliverable).
 *
 * WHAT "% DROP" MEANS HERE (the semantics this op pins down): density is COUNTING.
 * For a print with N localized motif instances, "remove p%" means remove
 * round(N * p/100) motif instances by count and keep the rest byte-identical. This
 * is periodicity-agnostic — exactly why scattered/tossed florals are density's
 * sweet spot (DENSITY_SCALE_STRATEGY.txt §1). So a preview is fully previewable and
 * the displayed numbers are exact, not estimates.
 *
 * TRUTHFULNESS: every preview step is produced by the SAME deterministic densityThin
 * the billed op runs. So the preview a user sees at p% is byte-identical to what
 * they get when they pick p%. No separate "preview-only" approximation that could
 * diverge from the real result.
 *
 * NO-OP HONESTY (§1 "never bill for a no-op"): each step reports the REQUESTED
 * removal (round(N*p/100)) AND the ACTUAL removed. On a degrade (densityThin
 * refuses — missing/empty raster, no bare ground, dim drift) actual `removed` is 0
 * and `noop` is true; the caller must surface that and never charge for it.
 *
 * Pure + deterministic. No sharp/raster-encode here — steps carry raw RGBA so the
 * caller (UI/eval) decides how to render. See densityPreviewEval for the strip.
 */
import { decodeUpright } from "../../image/decodeUpright";
import { densityThin, type DensityInput } from "./densityThin";

/** The preview percentages Frank asked for. */
export const DEFAULT_PREVIEW_PERCENTS = [10, 20, 50] as const;

export interface DensityPreviewStep {
  /** Requested removal percentage (0..90). */
  percent: number;
  /** Total motif instances detected on the fabric. */
  totalMotifs: number;
  /** round(totalMotifs * percent/100) — what "remove p%" asks for, by count. */
  requestedRemoval: number;
  /** Motifs actually erased. Equals requestedRemoval on the happy path; 0 when nothing
   *  was erased — either a legitimate no-op request (percent 0 / no motifs) or a degrade. */
  removed: number;
  /** Motifs remaining = totalMotifs - removed. */
  kept: number;
  /** True when nothing was erased (removed === 0) — caller must not bill. This covers BOTH
   *  a legitimate no-op (percent 0 or totalMotifs 0) AND a degrade/refund; to single out a
   *  degrade specifically, check `noop && requestedRemoval > 0` (see summarizePreviewStep). */
  noop: boolean;
  /** Preview pixels, raw RGBA (width*height*4). On a no-op this is the source, unchanged. */
  data: Buffer;
  width: number;
  height: number;
}

export interface DensityPreviewResult {
  totalMotifs: number;
  width: number;
  height: number;
  /** Source pixels (raw RGBA) — the "0%" reference for the strip. */
  original: Buffer;
  /** One entry per requested percent, in input order. */
  steps: DensityPreviewStep[];
}

export interface DensityPreviewInput extends Omit<DensityInput, "percent"> {
  /** Defaults to [10, 20, 50]. Values are clamped to 0..90 (DENSITY_MAX). */
  percents?: readonly number[];
}

const clampPct = (v: number) => Math.max(0, Math.min(90, Math.round(v)));

/**
 * Run the deterministic count-based thin at each requested percent and collect the
 * previews + exact count semantics. Decodes the source once for the 0% reference;
 * densityThin re-decodes per step (acceptable for a preview/eval path).
 */
export async function densityPreview(input: DensityPreviewInput): Promise<DensityPreviewResult> {
  const { buffer: original, width, height } = await decodeUpright(input.image.url);
  const totalMotifs = input.instances.length;
  const percents = (input.percents ?? DEFAULT_PREVIEW_PERCENTS).map(clampPct);

  const steps: DensityPreviewStep[] = [];
  for (const percent of percents) {
    const requestedRemoval = Math.min(totalMotifs, Math.round((totalMotifs * percent) / 100));
    const res = await densityThin({ ...input, percent });
    steps.push({
      percent,
      totalMotifs,
      requestedRemoval,
      removed: res.removed,
      kept: totalMotifs - res.removed,
      noop: res.removed === 0,
      data: res.data,
      width: res.width,
      height: res.height,
    });
  }

  return { totalMotifs, width, height, original, steps };
}

/**
 * One-line human summary per step, e.g.
 *   "40 motifs · −10% → remove 4 · 36 remain".
 * Marks a degrade explicitly so a no-op never reads as a successful removal.
 */
export function summarizePreviewStep(s: DensityPreviewStep): string {
  if (s.noop && s.requestedRemoval > 0) {
    return `${s.totalMotifs} motifs · −${s.percent}% → requested ${s.requestedRemoval}, REMOVED 0 (no-op/refund)`;
  }
  return `${s.totalMotifs} motifs · −${s.percent}% → remove ${s.removed} · ${s.kept} remain`;
}
