/**
 * P1 SAM3 acceptance bar — determinism gates (A3/A4) + the locked A1–A5 verdict.
 * Pure logic; no model calls.
 */
import { describe, it, expect } from "vitest";
import {
  countStability,
  countStableRate,
  maskIoU,
  allByteIdentical,
  maskStability,
  applyAcceptanceBar,
  type AcceptanceInputs,
} from "./_core/studio/eval/sam3AcceptanceBar";

const mask = (...vals: number[]) => Uint8Array.from(vals.map((v) => (v ? 255 : 0)));

describe("determinism gates (A3 count / A4 mask)", () => {
  it("countStability: identical counts are stable; any drift is not", () => {
    expect(countStability([12, 12, 12]).stable).toBe(true);
    expect(countStability([12, 11, 12])).toEqual({ stable: false, distinct: 2 });
    expect(countStability([]).stable).toBe(false);
  });

  it("countStableRate: fraction of garments with identical K counts", () => {
    expect(countStableRate([[5, 5, 5], [3, 3, 3]])).toBe(1);
    expect(countStableRate([[5, 5, 5], [3, 4, 3]])).toBe(0.5);
    expect(countStableRate([])).toBe(0);
  });

  it("maskIoU + allByteIdentical", () => {
    expect(maskIoU(mask(1, 1, 0, 0), mask(1, 1, 0, 0))).toBe(1);
    expect(maskIoU(mask(1, 1, 0, 0), mask(0, 0, 1, 1))).toBe(0);
    expect(maskIoU(mask(1, 1, 1, 0), mask(1, 1, 0, 0))).toBeCloseTo(2 / 3, 5);
    expect(allByteIdentical([mask(1, 0), mask(1, 0)])).toBe(true);
    expect(allByteIdentical([mask(1, 0), mask(0, 1)])).toBe(false);
  });

  it("maskStability: byte-identical runs → IoU 1 + byteIdentical true", () => {
    const cov = [mask(1, 1, 0, 0), mask(1, 1, 0, 0), mask(1, 1, 0, 0)];
    expect(maskStability(cov)).toEqual({ meanIoU: 1, byteIdentical: true });
  });

  it("maskStability: drifting runs → IoU < 1 + byteIdentical false", () => {
    const cov = [mask(1, 1, 1, 0), mask(1, 1, 0, 0)];
    const r = maskStability(cov);
    expect(r.byteIdentical).toBe(false);
    expect(r.meanIoU).toBeCloseTo(2 / 3, 5);
  });
});

describe("applyAcceptanceBar (locked A1–A5)", () => {
  const sam2 = { countMAE: 0.40, giantInstanceRate: 0.05, overSegRatio: 1.2, scaleFalseRejectRate: 0.33 };

  it("passes only when ALL of A1–A5 hold", () => {
    const inp: AcceptanceInputs = {
      sam2,
      sam3: { countMAE: 0.20, giantInstanceRate: 0.03, overSegRatio: 1.05, scaleFalseRejectRate: 0.10 },
      determinism: { countStableRate: 1.0, maskMeanIoU: 0.995, maskByteIdenticalRate: 1.0 },
    };
    const v = applyAcceptanceBar(inp);
    expect(v.pass).toBe(true);
    expect(v.checks.map((c) => c.id)).toEqual(["A1", "A2", "A3", "A4", "A5"]);
    expect(v.checks.every((c) => c.pass)).toBe(true);
  });

  it("fails A1 when count MAE isn't ≥25% better", () => {
    const inp: AcceptanceInputs = {
      sam2,
      sam3: { countMAE: 0.35, giantInstanceRate: 0.03, overSegRatio: 1.05, scaleFalseRejectRate: 0.10 },
      determinism: { countStableRate: 1.0, maskMeanIoU: 0.995, maskByteIdenticalRate: 1.0 },
    };
    const v = applyAcceptanceBar(inp);
    expect(v.pass).toBe(false);
    expect(v.checks.find((c) => c.id === "A1")!.pass).toBe(false);
  });

  it("fails A3 on any count drift under pin (billing-contract gate)", () => {
    const inp: AcceptanceInputs = {
      sam2,
      sam3: { countMAE: 0.10, giantInstanceRate: 0.03, overSegRatio: 1.05, scaleFalseRejectRate: 0.10 },
      determinism: { countStableRate: 0.98, maskMeanIoU: 0.999, maskByteIdenticalRate: 1.0 },
    };
    const v = applyAcceptanceBar(inp);
    expect(v.pass).toBe(false);
    expect(v.checks.find((c) => c.id === "A3")!.pass).toBe(false);
  });

  it("fails A4 when masks aren't pixel-stable", () => {
    const inp: AcceptanceInputs = {
      sam2,
      sam3: { countMAE: 0.10, giantInstanceRate: 0.03, overSegRatio: 1.05, scaleFalseRejectRate: 0.10 },
      determinism: { countStableRate: 1.0, maskMeanIoU: 0.90, maskByteIdenticalRate: 0.2 },
    };
    const v = applyAcceptanceBar(inp);
    expect(v.pass).toBe(false);
    expect(v.checks.find((c) => c.id === "A4")!.pass).toBe(false);
  });

  it("fails A2 on a giant-instance / over-seg regression", () => {
    const inp: AcceptanceInputs = {
      sam2,
      sam3: { countMAE: 0.10, giantInstanceRate: 0.09, overSegRatio: 1.5, scaleFalseRejectRate: 0.10 },
      determinism: { countStableRate: 1.0, maskMeanIoU: 0.999, maskByteIdenticalRate: 1.0 },
    };
    const v = applyAcceptanceBar(inp);
    expect(v.pass).toBe(false);
    expect(v.checks.find((c) => c.id === "A2")!.pass).toBe(false);
  });
});
