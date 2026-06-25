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
    // Raised after the scattered-coverage reframe (Phase-1): the FFT path plus the
    // all-over coverage path now accept periodic AND tossed/scattered prints. Floor
    // locked at 8/9 (only the synthetic checkerboard stress case misses — real garment
    // prints are not checkerboards). Anti-split safety (reject 5/5) is the test above.
    expect(r.acceptPass).toBeGreaterThanOrEqual(8);
  });
});
