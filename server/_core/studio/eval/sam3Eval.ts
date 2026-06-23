/**
 * T2.2 — SAM3 PCS vs SAM2 evaluation harness.
 *
 * Runs both models on a labeled test set and computes comparison metrics.
 * Decision rule: flip to SAM3 ONLY IF ALL hold:
 *   - Instance recall ↑ materially (>10% relative improvement)
 *   - Count error ↓
 *   - Boundary IoU not worse (within 5% tolerance)
 *   - Latency/cost acceptable (< 2x SAM2 cost)
 *
 * The harness is model-agnostic: it takes a SegmentationProvider interface
 * and runs it against ground truth. SAM2 and SAM3 are both providers.
 */
import { createHash } from "node:crypto";
import path from "node:path";
import fs from "node:fs/promises";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface BBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface GroundTruthInstance {
  id: number;
  bbox: BBox;
  maskFile: string;
  partial?: boolean;
}

export interface GroundTruth {
  instanceCount: number;
  printType: "dense_allover_floral" | "geometric_repeat" | "scattered_tossed" | "placement" | "border";
  instances: GroundTruthInstance[];
}

export interface PredictedInstance {
  bbox: BBox;
  mask: Uint8Array; // binary mask at image dims
  confidence: number;
}

export interface SegmentationResult {
  instances: PredictedInstance[];
  latencyMs: number;
  costUsd: number;
}

/** A model that can segment instances from an image. */
export interface SegmentationProvider {
  name: string;
  /** Segment all motif instances in the image. */
  segment(imageBuffer: Buffer, width: number, height: number, conceptPrompt?: string): Promise<SegmentationResult>;
}

// ─── Metrics ─────────────────────────────────────────────────────────────────

export interface PerImageMetrics {
  imageId: string;
  printType: string;
  trueCount: number;
  predCount: number;
  instanceRecall: number;     // found / true
  instancePrecision: number;  // 1 - spurious / found
  boundaryIoU: number;        // mean IoU on matched instances
  countError: number;         // |pred - true| / true
  latencyMs: number;
  costUsd: number;
}

export interface AggregateMetrics {
  modelName: string;
  totalImages: number;
  meanInstanceRecall: number;
  meanInstancePrecision: number;
  meanBoundaryIoU: number;
  meanCountError: number;
  medianLatencyMs: number;
  totalCostUsd: number;
  perType: Record<string, {
    count: number;
    meanRecall: number;
    meanPrecision: number;
    meanCountError: number;
  }>;
}

/**
 * Match predicted instances to ground truth using IoU-based Hungarian matching.
 * Returns: [matched pairs (gt_idx, pred_idx)[], unmatched_gt[], unmatched_pred[]]
 */
export function matchInstances(
  gtMasks: Uint8Array[],
  predMasks: Uint8Array[],
  width: number,
  height: number,
  iouThreshold = 0.3
): { matched: [number, number][]; unmatchedGt: number[]; unmatchedPred: number[] } {
  const n = gtMasks.length;
  const m = predMasks.length;

  // Compute IoU matrix
  const iouMatrix: number[][] = Array.from({ length: n }, () => Array(m).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < m; j++) {
      let intersection = 0, union = 0;
      for (let p = 0; p < width * height; p++) {
        const a = gtMasks[i][p] > 127 ? 1 : 0;
        const b = predMasks[j][p] > 127 ? 1 : 0;
        intersection += a & b;
        union += a | b;
      }
      iouMatrix[i][j] = union > 0 ? intersection / union : 0;
    }
  }

  // Greedy matching (best IoU first, above threshold)
  const matched: [number, number][] = [];
  const usedGt = new Set<number>();
  const usedPred = new Set<number>();

  // Flatten and sort by IoU descending
  const pairs: { i: number; j: number; iou: number }[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < m; j++) {
      if (iouMatrix[i][j] >= iouThreshold) {
        pairs.push({ i, j, iou: iouMatrix[i][j] });
      }
    }
  }
  pairs.sort((a, b) => b.iou - a.iou);

  for (const { i, j } of pairs) {
    if (usedGt.has(i) || usedPred.has(j)) continue;
    matched.push([i, j]);
    usedGt.add(i);
    usedPred.add(j);
  }

  const unmatchedGt = Array.from({ length: n }, (_, i) => i).filter(i => !usedGt.has(i));
  const unmatchedPred = Array.from({ length: m }, (_, j) => j).filter(j => !usedPred.has(j));

  return { matched, unmatchedGt, unmatchedPred };
}

/**
 * Compute per-image metrics for a single evaluation case.
 */
export function computePerImageMetrics(
  imageId: string,
  printType: string,
  gt: GroundTruth,
  result: SegmentationResult,
  gtMasks: Uint8Array[],
  width: number,
  height: number
): PerImageMetrics {
  const predMasks = result.instances.map(i => i.mask);
  const { matched, unmatchedGt, unmatchedPred } = matchInstances(gtMasks, predMasks, width, height);

  const trueCount = gt.instanceCount;
  const predCount = result.instances.length;
  const found = matched.length;
  const spurious = unmatchedPred.length;

  // Boundary IoU: mean IoU of matched pairs
  let totalIoU = 0;
  for (const [gtIdx, predIdx] of matched) {
    let intersection = 0, union = 0;
    for (let p = 0; p < width * height; p++) {
      const a = gtMasks[gtIdx][p] > 127 ? 1 : 0;
      const b = predMasks[predIdx][p] > 127 ? 1 : 0;
      intersection += a & b;
      union += a | b;
    }
    totalIoU += union > 0 ? intersection / union : 0;
  }

  return {
    imageId,
    printType,
    trueCount,
    predCount,
    instanceRecall: trueCount > 0 ? found / trueCount : 0,
    instancePrecision: predCount > 0 ? 1 - spurious / predCount : 0,
    boundaryIoU: matched.length > 0 ? totalIoU / matched.length : 0,
    countError: trueCount > 0 ? Math.abs(predCount - trueCount) / trueCount : 0,
    latencyMs: result.latencyMs,
    costUsd: result.costUsd,
  };
}

/**
 * Aggregate per-image metrics into model-level summary.
 */
export function aggregateMetrics(modelName: string, perImage: PerImageMetrics[]): AggregateMetrics {
  const n = perImage.length;
  if (n === 0) {
    return {
      modelName, totalImages: 0,
      meanInstanceRecall: 0, meanInstancePrecision: 0,
      meanBoundaryIoU: 0, meanCountError: 0,
      medianLatencyMs: 0, totalCostUsd: 0, perType: {},
    };
  }

  const mean = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
  const median = (arr: number[]) => {
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  };

  // Per-type breakdown
  const byType: Record<string, PerImageMetrics[]> = {};
  for (const m of perImage) {
    (byType[m.printType] ??= []).push(m);
  }
  const perType: AggregateMetrics["perType"] = {};
  for (const [type, items] of Object.entries(byType)) {
    perType[type] = {
      count: items.length,
      meanRecall: mean(items.map(i => i.instanceRecall)),
      meanPrecision: mean(items.map(i => i.instancePrecision)),
      meanCountError: mean(items.map(i => i.countError)),
    };
  }

  return {
    modelName,
    totalImages: n,
    meanInstanceRecall: mean(perImage.map(i => i.instanceRecall)),
    meanInstancePrecision: mean(perImage.map(i => i.instancePrecision)),
    meanBoundaryIoU: mean(perImage.map(i => i.boundaryIoU)),
    meanCountError: mean(perImage.map(i => i.countError)),
    medianLatencyMs: median(perImage.map(i => i.latencyMs)),
    totalCostUsd: perImage.reduce((s, i) => s + i.costUsd, 0),
    perType,
  };
}

// ─── Decision Rule ───────────────────────────────────────────────────────────

export interface ComparisonVerdict {
  winner: "sam3" | "sam2" | "inconclusive";
  reasons: string[];
  recallImprovement: number;   // relative %
  countErrorDelta: number;     // sam3 - sam2 (negative = improvement)
  iouDelta: number;            // sam3 - sam2 (positive = improvement)
  costRatio: number;           // sam3 / sam2
}

/**
 * Apply the decision rule: flip to SAM3 only if ALL conditions hold.
 */
export function applyDecisionRule(sam2: AggregateMetrics, sam3: AggregateMetrics): ComparisonVerdict {
  const recallImprovement = sam2.meanInstanceRecall > 0
    ? (sam3.meanInstanceRecall - sam2.meanInstanceRecall) / sam2.meanInstanceRecall
    : 0;
  const countErrorDelta = sam3.meanCountError - sam2.meanCountError;
  const iouDelta = sam3.meanBoundaryIoU - sam2.meanBoundaryIoU;
  const costRatio = sam2.totalCostUsd > 0 ? sam3.totalCostUsd / sam2.totalCostUsd : 1;

  const reasons: string[] = [];
  let allPass = true;

  // Condition 1: Instance recall ↑ materially (>10% relative)
  if (recallImprovement > 0.10) {
    reasons.push(`✓ Recall improved ${(recallImprovement * 100).toFixed(1)}% (>10% threshold)`);
  } else {
    reasons.push(`✗ Recall improvement ${(recallImprovement * 100).toFixed(1)}% (need >10%)`);
    allPass = false;
  }

  // Condition 2: Count error ↓
  if (countErrorDelta < 0) {
    reasons.push(`✓ Count error reduced by ${(-countErrorDelta * 100).toFixed(1)}pp`);
  } else {
    reasons.push(`✗ Count error increased by ${(countErrorDelta * 100).toFixed(1)}pp`);
    allPass = false;
  }

  // Condition 3: Boundary IoU not worse (within 5% tolerance)
  if (iouDelta >= -0.05) {
    reasons.push(`✓ Boundary IoU delta ${(iouDelta * 100).toFixed(1)}pp (within tolerance)`);
  } else {
    reasons.push(`✗ Boundary IoU degraded by ${(-iouDelta * 100).toFixed(1)}pp (>5% tolerance)`);
    allPass = false;
  }

  // Condition 4: Cost acceptable (< 2x)
  if (costRatio < 2.0) {
    reasons.push(`✓ Cost ratio ${costRatio.toFixed(2)}x (< 2x threshold)`);
  } else {
    reasons.push(`✗ Cost ratio ${costRatio.toFixed(2)}x (exceeds 2x threshold)`);
    allPass = false;
  }

  return {
    winner: allPass ? "sam3" : "inconclusive",
    reasons,
    recallImprovement,
    countErrorDelta,
    iouDelta,
    costRatio,
  };
}

// ─── Report Generation ───────────────────────────────────────────────────────

/**
 * Generate a markdown comparison report.
 */
export function generateReport(
  sam2Metrics: AggregateMetrics,
  sam3Metrics: AggregateMetrics,
  sam2PerImage: PerImageMetrics[],
  sam3PerImage: PerImageMetrics[],
  verdict: ComparisonVerdict
): string {
  const lines: string[] = [
    "# SAM3 PCS vs SAM2 — Evaluation Results",
    "",
    `**Date:** ${new Date().toISOString().split("T")[0]}`,
    `**Test set:** ${sam2Metrics.totalImages} images`,
    "",
    "## Summary",
    "",
    `| Metric | SAM2 | SAM3 | Delta |`,
    `|--------|------|------|-------|`,
    `| Instance Recall | ${(sam2Metrics.meanInstanceRecall * 100).toFixed(1)}% | ${(sam3Metrics.meanInstanceRecall * 100).toFixed(1)}% | ${verdict.recallImprovement > 0 ? "+" : ""}${(verdict.recallImprovement * 100).toFixed(1)}% |`,
    `| Instance Precision | ${(sam2Metrics.meanInstancePrecision * 100).toFixed(1)}% | ${(sam3Metrics.meanInstancePrecision * 100).toFixed(1)}% | ${((sam3Metrics.meanInstancePrecision - sam2Metrics.meanInstancePrecision) * 100).toFixed(1)}pp |`,
    `| Boundary IoU | ${(sam2Metrics.meanBoundaryIoU * 100).toFixed(1)}% | ${(sam3Metrics.meanBoundaryIoU * 100).toFixed(1)}% | ${verdict.iouDelta > 0 ? "+" : ""}${(verdict.iouDelta * 100).toFixed(1)}pp |`,
    `| Count Error | ${(sam2Metrics.meanCountError * 100).toFixed(1)}% | ${(sam3Metrics.meanCountError * 100).toFixed(1)}% | ${verdict.countErrorDelta > 0 ? "+" : ""}${(verdict.countErrorDelta * 100).toFixed(1)}pp |`,
    `| Median Latency | ${sam2Metrics.medianLatencyMs.toFixed(0)}ms | ${sam3Metrics.medianLatencyMs.toFixed(0)}ms | ${verdict.costRatio.toFixed(2)}x |`,
    `| Total Cost | $${sam2Metrics.totalCostUsd.toFixed(4)} | $${sam3Metrics.totalCostUsd.toFixed(4)} | ${verdict.costRatio.toFixed(2)}x |`,
    "",
    "## Decision",
    "",
    `**Verdict: ${verdict.winner.toUpperCase()}**`,
    "",
    ...verdict.reasons.map(r => `- ${r}`),
    "",
    "## Per-Type Breakdown",
    "",
  ];

  // Per-type table
  const types = Object.keys(sam2Metrics.perType);
  if (types.length > 0) {
    lines.push("| Print Type | SAM2 Recall | SAM3 Recall | SAM2 Count Err | SAM3 Count Err |");
    lines.push("|---|---|---|---|---|");
    for (const t of types) {
      const s2 = sam2Metrics.perType[t];
      const s3 = sam3Metrics.perType[t] ?? { meanRecall: 0, meanCountError: 0, count: 0, meanPrecision: 0 };
      lines.push(`| ${t} (n=${s2?.count ?? 0}) | ${((s2?.meanRecall ?? 0) * 100).toFixed(1)}% | ${(s3.meanRecall * 100).toFixed(1)}% | ${((s2?.meanCountError ?? 0) * 100).toFixed(1)}% | ${(s3.meanCountError * 100).toFixed(1)}% |`);
    }
    lines.push("");
  }

  lines.push("## Routing Recommendation");
  lines.push("");
  if (verdict.winner === "sam3") {
    lines.push("SAM3 wins across the board. Recommended: swap SAM2 → SAM3 for all print types.");
  } else {
    // Check per-type wins
    const sam3WinsTypes: string[] = [];
    for (const t of types) {
      const s2 = sam2Metrics.perType[t];
      const s3 = sam3Metrics.perType[t];
      if (s2 && s3 && s3.meanRecall > s2.meanRecall * 1.1 && s3.meanCountError < s2.meanCountError) {
        sam3WinsTypes.push(t);
      }
    }
    if (sam3WinsTypes.length > 0) {
      lines.push(`SAM3 wins on: ${sam3WinsTypes.join(", ")}. Consider routing by print-type:`);
      lines.push(`- SAM3 for: ${sam3WinsTypes.join(", ")}`);
      lines.push(`- SAM2 for: ${types.filter(t => !sam3WinsTypes.includes(t)).join(", ")}`);
    } else {
      lines.push("SAM3 does not materially outperform SAM2 on any class. Keep SAM2.");
    }
  }

  return lines.join("\n");
}
