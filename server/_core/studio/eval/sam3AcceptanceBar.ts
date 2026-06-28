/**
 * P1 SAM3 eval — the LOCKED acceptance bar (A1–A5) + determinism gates.
 *
 * The pre-existing sam3Eval.ts scaffold had recall/precision/IoU/count metrics and
 * an OLD decision rule (recall>10%, cost<2x). This module adds what the architect
 * elevated to first-class and the scaffold was missing: DETERMINISM as a pass/fail
 * axis (A3 count-stability + A4 mask-stability) and the locked A1–A5 bar. Pure +
 * deterministic — fully unit-tested without model calls. The IO runner feeds the
 * measured inputs in; this module is the verdict.
 *
 * See docs/STUDIO_SAM3_EVAL_WORKORDER_2026-06-28.txt for the locked thresholds.
 */

// ─── Determinism gates (A3 / A4) ───────────────────────────────────────────────

/** A3 — count stability: are the K repeat counts for one garment all identical? */
export function countStability(countsForOneImage: number[]): { stable: boolean; distinct: number } {
  const distinct = new Set(countsForOneImage).size;
  return { stable: countsForOneImage.length > 0 && distinct === 1, distinct };
}

/** Aggregate A3 across the set: fraction of garments whose K counts were identical. */
export function countStableRate(countsPerImage: number[][]): number {
  if (countsPerImage.length === 0) return 0;
  const stable = countsPerImage.filter((c) => countStability(c).stable).length;
  return stable / countsPerImage.length;
}

/** IoU of two equal-length binary masks (>127 = on). */
export function maskIoU(a: Uint8Array, b: Uint8Array): number {
  let inter = 0, union = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a[i] > 127 ? 1 : 0, y = b[i] > 127 ? 1 : 0;
    inter += x & y; union += x | y;
  }
  return union > 0 ? inter / union : 1; // two empty masks are trivially identical
}

/** True iff every mask in the set is byte-identical to the first. */
export function allByteIdentical(masks: Uint8Array[]): boolean {
  if (masks.length <= 1) return true;
  const first = masks[0];
  return masks.every((m) => m.length === first.length && m.every((v, i) => v === first[i]));
}

/**
 * A4 — mask stability for ONE garment across K repeat runs. Each run is reduced to a
 * single coverage mask (union of its instance masks). Returns mean IoU of run[0] vs
 * each other run, and whether all K coverage masks are byte-identical.
 */
export function maskStability(coveragePerRun: Uint8Array[]): { meanIoU: number; byteIdentical: boolean } {
  if (coveragePerRun.length <= 1) return { meanIoU: 1, byteIdentical: true };
  const base = coveragePerRun[0];
  let sum = 0;
  for (let i = 1; i < coveragePerRun.length; i++) sum += maskIoU(base, coveragePerRun[i]);
  return { meanIoU: sum / (coveragePerRun.length - 1), byteIdentical: allByteIdentical(coveragePerRun) };
}

// ─── Locked acceptance bar (A1–A5) ─────────────────────────────────────────────

export interface ProviderEvalSummary {
  countMAE: number;          // mean |pred − true| / true  (the existing meanCountError)
  giantInstanceRate: number; // fraction of instances > MAX_INSTANCE_FRACTION of crop
  overSegRatio: number;      // mean predicted/true count
  scaleFalseRejectRate: number; // false-reject rate of the scale repeat detector fed by this provider
}

export interface DeterminismSummary {
  countStableRate: number;   // A3 — fraction of garments with identical K counts (pass = 1.0)
  maskMeanIoU: number;       // A4 — mean coverage IoU across K runs (pass ≥ 0.99)
  maskByteIdenticalRate: number; // reported: fraction of garments byte-stable across K runs
}

export interface AcceptanceInputs {
  sam2: ProviderEvalSummary;
  sam3: ProviderEvalSummary;
  determinism: DeterminismSummary; // measured on SAM3 (the candidate)
}

export interface AcceptanceCheck { id: string; pass: boolean; detail: string }
export interface AcceptanceVerdict { pass: boolean; checks: AcceptanceCheck[] }

// Locked thresholds (work order §P1; architect-delegated, pre-run).
export const A1_COUNT_MAE_RATIO = 0.75; // SAM3 ≤ 0.75× SAM2
export const A3_COUNT_STABLE_RATE = 1.0; // 100% identical under pin
export const A4_MASK_MEAN_IOU = 0.99;

/**
 * Apply the locked A1–A5 bar. SAM3 ships as the candidate ONLY if ALL pass.
 * Determinism (A3) is hard: if counts aren't stable under pin, SAM3 cannot touch the
 * money path regardless of accuracy (the caller decides quarantine vs reject).
 */
export function applyAcceptanceBar(inp: AcceptanceInputs): AcceptanceVerdict {
  const { sam2, sam3, determinism } = inp;
  const checks: AcceptanceCheck[] = [];

  // A1 — count accuracy beats SAM2 by a real margin.
  const a1 = sam3.countMAE <= A1_COUNT_MAE_RATIO * sam2.countMAE;
  checks.push({ id: "A1", pass: a1, detail: `count MAE sam3=${sam3.countMAE.toFixed(3)} vs sam2=${sam2.countMAE.toFixed(3)} (need ≤ ${A1_COUNT_MAE_RATIO}× = ${(A1_COUNT_MAE_RATIO * sam2.countMAE).toFixed(3)})` });

  // A2 — no regression on giant-instance / over-segmentation.
  const a2 = sam3.giantInstanceRate <= sam2.giantInstanceRate && sam3.overSegRatio <= sam2.overSegRatio;
  checks.push({ id: "A2", pass: a2, detail: `giant sam3=${sam3.giantInstanceRate.toFixed(3)}≤sam2=${sam2.giantInstanceRate.toFixed(3)} & overSeg sam3=${sam3.overSegRatio.toFixed(2)}≤sam2=${sam2.overSegRatio.toFixed(2)}` });

  // A3 — count stability under pin (billing-contract test).
  const a3 = determinism.countStableRate >= A3_COUNT_STABLE_RATE;
  checks.push({ id: "A3", pass: a3, detail: `count-stable rate=${(determinism.countStableRate * 100).toFixed(1)}% (need 100%)` });

  // A4 — mask stability (cache-moat test).
  const a4 = determinism.maskMeanIoU >= A4_MASK_MEAN_IOU;
  checks.push({ id: "A4", pass: a4, detail: `mask mean IoU=${determinism.maskMeanIoU.toFixed(4)} (need ≥ ${A4_MASK_MEAN_IOU}); byte-identical rate=${(determinism.maskByteIdenticalRate * 100).toFixed(1)}%` });

  // A5 — scale false-reject improved vs SAM2-fed detector.
  const a5 = sam3.scaleFalseRejectRate < sam2.scaleFalseRejectRate;
  checks.push({ id: "A5", pass: a5, detail: `scale false-reject sam3=${(sam3.scaleFalseRejectRate * 100).toFixed(1)}% < sam2=${(sam2.scaleFalseRejectRate * 100).toFixed(1)}%` });

  return { pass: checks.every((c) => c.pass), checks };
}
