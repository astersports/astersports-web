/**
 * SCALE detector flip-gate regression guard (G3, scale half).
 *
 * The −50% "split in two" incident was a placement-print garment passing the weak
 * repeat guard and getting mirror-tiled. The fix routes scale through
 * checkRepeatAdvanced/detectRepeat. This test locks the SAFETY property: every
 * placement/border fixture MUST be rejected (never accepted for scaling). It also
 * reports accept-side accuracy with a floor so calibration progress is tracked and
 * can't regress.
 */
import { describe, it, expect } from "vitest";
import { runDetectorEval, formatDetectorEval } from "./_core/studio/eval/detectorAccuracy";

describe("scale detector flip-gate accuracy", () => {
  const r = runDetectorEval();

  it("NEVER accepts a non-repeat (placement/border) — the anti-split safety property", () => {
    // Hard guard: a regression here means scale could mirror-tile a garment again.
    const wrongAccepts = r.rows.filter((row) => !row.wantAccept && row.accept);
    expect(wrongAccepts, `${formatDetectorEval(r)}`).toEqual([]);
    expect(r.rejectPass).toBe(r.rejectTotal);
  });

  it("accepts genuine repeats at or above the calibration floor (raise as the detector is tuned)", () => {
    // Acceptance is intentionally conservative pre-calibration. This floor prevents
    // regression and should be raised toward acceptTotal once thresholds are tuned
    // on a real labeled garment set. Current baseline: 4/6 synthetic.
    expect(r.acceptPass).toBeGreaterThanOrEqual(4);
  });
});
