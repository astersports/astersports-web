/**
 * T2.2 — SAM3 PCS evaluation harness unit tests.
 *
 * Tests the metrics computation, instance matching, decision rule, and report
 * generation without needing real model calls or ground truth images.
 */
import { describe, it, expect } from "vitest";
import {
  matchInstances,
  computePerImageMetrics,
  aggregateMetrics,
  applyDecisionRule,
  generateReport,
  type GroundTruth,
  type SegmentationResult,
  type AggregateMetrics,
} from "../server/_core/studio/eval/sam3Eval";

describe("T2.2 — SAM3 PCS evaluation harness", () => {
  const W = 10, H = 10;

  // Helper: create a mask with a filled rectangle
  function rectMask(x0: number, y0: number, x1: number, y1: number): Uint8Array {
    const mask = new Uint8Array(W * H);
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) mask[y * W + x] = 255;
    return mask;
  }

  describe("matchInstances", () => {
    it("matches identical masks perfectly", () => {
      const gt = [rectMask(0, 0, 5, 5), rectMask(5, 5, 10, 10)];
      const pred = [rectMask(0, 0, 5, 5), rectMask(5, 5, 10, 10)];
      const { matched, unmatchedGt, unmatchedPred } = matchInstances(gt, pred, W, H);
      expect(matched.length).toBe(2);
      expect(unmatchedGt.length).toBe(0);
      expect(unmatchedPred.length).toBe(0);
    });

    it("detects spurious predictions", () => {
      const gt = [rectMask(0, 0, 5, 5)];
      const pred = [rectMask(0, 0, 5, 5), rectMask(5, 5, 10, 10)];
      const { matched, unmatchedGt, unmatchedPred } = matchInstances(gt, pred, W, H);
      expect(matched.length).toBe(1);
      expect(unmatchedGt.length).toBe(0);
      expect(unmatchedPred.length).toBe(1);
    });

    it("detects missed ground truth", () => {
      const gt = [rectMask(0, 0, 5, 5), rectMask(5, 5, 10, 10)];
      const pred = [rectMask(0, 0, 5, 5)];
      const { matched, unmatchedGt, unmatchedPred } = matchInstances(gt, pred, W, H);
      expect(matched.length).toBe(1);
      expect(unmatchedGt.length).toBe(1);
      expect(unmatchedPred.length).toBe(0);
    });

    it("rejects low-IoU matches", () => {
      const gt = [rectMask(0, 0, 5, 5)];
      const pred = [rectMask(4, 4, 9, 9)]; // minimal overlap
      const { matched } = matchInstances(gt, pred, W, H, 0.3);
      // IoU of these two rects: overlap is 1x1=1, union is 25+25-1=49, IoU=1/49≈0.02
      expect(matched.length).toBe(0);
    });
  });

  describe("computePerImageMetrics", () => {
    it("computes perfect metrics for perfect predictions", () => {
      const gt: GroundTruth = {
        instanceCount: 2,
        printType: "geometric_repeat",
        instances: [
          { id: 1, bbox: { x: 0, y: 0, w: 0.5, h: 0.5 }, maskFile: "masks/001.png" },
          { id: 2, bbox: { x: 0.5, y: 0.5, w: 0.5, h: 0.5 }, maskFile: "masks/002.png" },
        ],
      };
      const result: SegmentationResult = {
        instances: [
          { bbox: { x: 0, y: 0, w: 0.5, h: 0.5 }, mask: rectMask(0, 0, 5, 5), confidence: 0.95 },
          { bbox: { x: 0.5, y: 0.5, w: 0.5, h: 0.5 }, mask: rectMask(5, 5, 10, 10), confidence: 0.92 },
        ],
        latencyMs: 3000,
        costUsd: 0.001,
      };
      const gtMasks = [rectMask(0, 0, 5, 5), rectMask(5, 5, 10, 10)];

      const metrics = computePerImageMetrics("test-001", "geometric_repeat", gt, result, gtMasks, W, H);
      expect(metrics.instanceRecall).toBe(1.0);
      expect(metrics.instancePrecision).toBe(1.0);
      expect(metrics.boundaryIoU).toBe(1.0);
      expect(metrics.countError).toBe(0);
    });

    it("computes correct metrics for partial predictions", () => {
      const gt: GroundTruth = {
        instanceCount: 3,
        printType: "dense_allover_floral",
        instances: [
          { id: 1, bbox: { x: 0, y: 0, w: 0.3, h: 0.3 }, maskFile: "masks/001.png" },
          { id: 2, bbox: { x: 0.3, y: 0.3, w: 0.3, h: 0.3 }, maskFile: "masks/002.png" },
          { id: 3, bbox: { x: 0.6, y: 0.6, w: 0.4, h: 0.4 }, maskFile: "masks/003.png" },
        ],
      };
      const result: SegmentationResult = {
        instances: [
          { bbox: { x: 0, y: 0, w: 0.3, h: 0.3 }, mask: rectMask(0, 0, 3, 3), confidence: 0.9 },
          // Only found 1 of 3
        ],
        latencyMs: 5000,
        costUsd: 0.002,
      };
      const gtMasks = [rectMask(0, 0, 3, 3), rectMask(3, 3, 6, 6), rectMask(6, 6, 10, 10)];

      const metrics = computePerImageMetrics("test-002", "dense_allover_floral", gt, result, gtMasks, W, H);
      expect(metrics.instanceRecall).toBeCloseTo(1 / 3, 2);
      expect(metrics.instancePrecision).toBe(1.0); // no spurious
      expect(metrics.countError).toBeCloseTo(2 / 3, 2); // |1-3|/3
    });
  });

  describe("applyDecisionRule", () => {
    it("recommends SAM3 when all conditions met", () => {
      const sam2: AggregateMetrics = {
        modelName: "sam2", totalImages: 30,
        meanInstanceRecall: 0.60, meanInstancePrecision: 0.85,
        meanBoundaryIoU: 0.70, meanCountError: 0.25,
        medianLatencyMs: 5000, totalCostUsd: 0.03, perType: {},
      };
      const sam3: AggregateMetrics = {
        modelName: "sam3", totalImages: 30,
        meanInstanceRecall: 0.85, meanInstancePrecision: 0.90,
        meanBoundaryIoU: 0.72, meanCountError: 0.10,
        medianLatencyMs: 8000, totalCostUsd: 0.05, perType: {},
      };
      const verdict = applyDecisionRule(sam2, sam3);
      expect(verdict.winner).toBe("sam3");
      expect(verdict.reasons.every(r => r.startsWith("✓"))).toBe(true);
    });

    it("returns inconclusive when recall improvement insufficient", () => {
      const sam2: AggregateMetrics = {
        modelName: "sam2", totalImages: 30,
        meanInstanceRecall: 0.80, meanInstancePrecision: 0.85,
        meanBoundaryIoU: 0.70, meanCountError: 0.15,
        medianLatencyMs: 5000, totalCostUsd: 0.03, perType: {},
      };
      const sam3: AggregateMetrics = {
        modelName: "sam3", totalImages: 30,
        meanInstanceRecall: 0.82, meanInstancePrecision: 0.88,
        meanBoundaryIoU: 0.72, meanCountError: 0.12,
        medianLatencyMs: 8000, totalCostUsd: 0.05, perType: {},
      };
      const verdict = applyDecisionRule(sam2, sam3);
      expect(verdict.winner).toBe("inconclusive");
      expect(verdict.reasons[0]).toContain("✗");
    });

    it("returns inconclusive when cost exceeds 2x", () => {
      const sam2: AggregateMetrics = {
        modelName: "sam2", totalImages: 30,
        meanInstanceRecall: 0.60, meanInstancePrecision: 0.85,
        meanBoundaryIoU: 0.70, meanCountError: 0.25,
        medianLatencyMs: 5000, totalCostUsd: 0.03, perType: {},
      };
      const sam3: AggregateMetrics = {
        modelName: "sam3", totalImages: 30,
        meanInstanceRecall: 0.85, meanInstancePrecision: 0.90,
        meanBoundaryIoU: 0.72, meanCountError: 0.10,
        medianLatencyMs: 30000, totalCostUsd: 0.10, perType: {}, // >2x cost
      };
      const verdict = applyDecisionRule(sam2, sam3);
      expect(verdict.winner).toBe("inconclusive");
    });
  });

  describe("generateReport", () => {
    it("produces valid markdown with all sections", () => {
      const sam2: AggregateMetrics = {
        modelName: "sam2", totalImages: 2,
        meanInstanceRecall: 0.70, meanInstancePrecision: 0.85,
        meanBoundaryIoU: 0.65, meanCountError: 0.20,
        medianLatencyMs: 5000, totalCostUsd: 0.002,
        perType: { dense_allover_floral: { count: 1, meanRecall: 0.65, meanPrecision: 0.80, meanCountError: 0.25 } },
      };
      const sam3: AggregateMetrics = {
        modelName: "sam3", totalImages: 2,
        meanInstanceRecall: 0.85, meanInstancePrecision: 0.90,
        meanBoundaryIoU: 0.70, meanCountError: 0.10,
        medianLatencyMs: 8000, totalCostUsd: 0.003,
        perType: { dense_allover_floral: { count: 1, meanRecall: 0.85, meanPrecision: 0.92, meanCountError: 0.08 } },
      };
      const verdict = applyDecisionRule(sam2, sam3);
      const report = generateReport(sam2, sam3, [], [], verdict);

      expect(report).toContain("# SAM3 PCS vs SAM2");
      expect(report).toContain("## Summary");
      expect(report).toContain("## Decision");
      expect(report).toContain("## Per-Type Breakdown");
      expect(report).toContain("## Routing Recommendation");
    });
  });
});
