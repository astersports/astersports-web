/**
 * Density eval-metric tests. Synthetic motif grid (64 instances) on textured
 * ground with truth instance labels. Even (stratified) vs clustered removal (R2),
 * count accuracy (R1), survivor integrity, infill, and bg-excluded-from-pass.
 */
import { describe, it, expect } from "vitest";
import { computeDensityMetrics, densityVerdict, computeNNI, type DensityMetricInput, type DensityMetrics } from "./_core/studio/eval/densityMetrics";

const W = 96, H = 96, P = 12, OFF = 6, N = 8, R = 3;
const MOTIF = [200, 80, 90];
const groundRGB = (i: number): number[] => [225 + (i % 5) - 2, 220 + (i % 3) - 1, 205]; // mild texture -> nonzero baseline

interface Built { source: Buffer; labels: Int32Array; centers: Array<{ id: number; col: number; row: number; px: number[] }>; }

function buildGrid(): Built {
  const source = Buffer.alloc(W * H * 4);
  const labels = new Int32Array(W * H).fill(-1);
  for (let i = 0; i < W * H; i++) { const p = i * 4; const g = groundRGB(i); source[p] = g[0]; source[p + 1] = g[1]; source[p + 2] = g[2]; source[p + 3] = 255; }
  const centers: Built["centers"] = [];
  for (let row = 0; row < N; row++) {
    for (let col = 0; col < N; col++) {
      const id = row * N + col, cx = OFF + col * P, cy = OFF + row * P, px: number[] = [];
      for (let y = cy - R; y <= cy + R; y++) for (let x = cx - R; x <= cx + R; x++) {
        if ((x - cx) ** 2 + (y - cy) ** 2 <= R * R && x >= 0 && x < W && y >= 0 && y < H) {
          const i = y * W + x; labels[i] = id; const p = i * 4; source[p] = MOTIF[0]; source[p + 1] = MOTIF[1]; source[p + 2] = MOTIF[2];
        }
      }
      for (let i = 0; i < W * H; i++) if (labels[i] === id) px.push(i);
      centers.push({ id, col, row, px });
    }
  }
  return { source, labels, centers };
}

/** Copy source, erase (paint textured ground) the motifs whose id satisfies `pick`. */
function eraseOut(b: Built, pick: (c: Built["centers"][number]) => boolean): Buffer {
  const out = Buffer.from(b.source);
  for (const c of b.centers) {
    if (!pick(c)) continue;
    for (const i of c.px) { const p = i * 4; const g = groundRGB(i); out[p] = g[0]; out[p + 1] = g[1]; out[p + 2] = g[2]; }
  }
  return out;
}

const FULL = new Uint8Array(W * H).fill(1);
const base = (b: Built, out: Buffer, mask = FULL): DensityMetricInput => ({
  source: b.source, out, width: W, height: H, truthMask: mask, truthInstanceLabels: b.labels, targetRemovalFraction: 0.25,
});

describe("computeDensityMetrics", () => {
  it("counts removed instances accurately and passes on stratified removal (R1/R2)", () => {
    const b = buildGrid();
    const out = eraseOut(b, (c) => c.col % 2 === 0 && c.row % 2 === 0); // 16 of 64 = 0.25, spread
    const m = computeDensityMetrics(base(b, out));
    expect(m.totalInstances).toBe(64);
    expect(m.removedInstances).toBe(16);
    expect(m.countError).toBeLessThanOrEqual(0.10);
    expect(m.survivorIntegrity).toBeLessThanOrEqual(2);
    const v = densityVerdict(m);
    expect(v.evennessPass).toBe(true);
    expect(v.pass).toBe(true);
  });

  it("flags clustered removal via evenness (same count, wrong distribution)", () => {
    const b = buildGrid();
    const out = eraseOut(b, (c) => c.row < 2); // 16 removed, all top -> clustered
    const m = computeDensityMetrics(base(b, out));
    expect(m.removedInstances).toBe(16);
    expect(m.countError).toBeLessThanOrEqual(0.10); // count is right
    const v = densityVerdict(m);
    expect(v.evennessPass).toBe(false); // distribution is wrong
    expect(v.pass).toBe(false);
  });

  it("flags under-removal as countError", () => {
    const b = buildGrid();
    const out = eraseOut(b, (c) => c.id < 4); // only 4 removed vs target 16
    const m = computeDensityMetrics(base(b, out));
    expect(m.measuredRemoval).toBeCloseTo(4 / 64, 5);
    expect(densityVerdict(m).countPass).toBe(false);
  });

  it("keeps survivors untouched (survivorIntegrity ~0)", () => {
    const b = buildGrid();
    const out = eraseOut(b, (c) => c.col % 2 === 0 && c.row % 2 === 0);
    const m = computeDensityMetrics(base(b, out));
    expect(m.survivorIntegrity).toBeLessThan(1);
  });

  it("bgDeltaE is the mask signal, excluded from pass", () => {
    const b = buildGrid();
    const mask = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) mask[y * W + x] = y < H - 12 ? 1 : 0; // bottom strip = bg
    const out = eraseOut(b, (c) => c.col % 2 === 0 && c.row % 2 === 0);
    // corrupt only true background ground (not motif pixels that overlap the strip)
    for (let y = H - 12; y < H; y++) for (let x = 0; x < W; x++) { const i = y * W + x; if (b.labels[i] >= 0) continue; const p = i * 4; out[p] = 20; out[p + 1] = 60; out[p + 2] = 160; }
    const m = computeDensityMetrics(base(b, out, mask));
    const v = densityVerdict(m);
    expect(m.bgDeltaE).toBeGreaterThan(2);
    expect(v.bgPass).toBe(false);
    expect(v.pass).toBe(true); // op correctness holds; background is the D1/mask call
  });

  it("is deterministic", () => {
    const b = buildGrid();
    const out = eraseOut(b, (c) => c.col % 2 === 0 && c.row % 2 === 0);
    expect(computeDensityMetrics(base(b, out))).toEqual(computeDensityMetrics(base(b, out)));
  });

  it("NNI >= 1.0 for stratified (dispersed) survivors", () => {
    const b = buildGrid();
    // Remove every other in a checkerboard pattern -> survivors are evenly spaced
    const out = eraseOut(b, (c) => c.col % 2 === 0 && c.row % 2 === 0);
    const m = computeDensityMetrics(base(b, out));
    expect(m.nniDispersion).toBeGreaterThanOrEqual(1.0);
    const v = densityVerdict(m);
    expect(v.nniPass).toBe(true);
  });

  it("NNI < 1.0 for clustered survivors (all survivors in one corner)", () => {
    const b = buildGrid();
    // Remove everything except the top-left 2x2 block (4 survivors, 60 removed)
    // This means survivors are clustered in one corner
    const out = eraseOut(b, (c) => !(c.col < 2 && c.row < 2));
    const m = computeDensityMetrics({
      ...base(b, out),
      targetRemovalFraction: 60 / 64, // match the actual removal
    });
    // With only 4 survivors clustered in a corner, NNI should be < 1
    expect(m.nniDispersion).toBeLessThan(1.0);
    const v = densityVerdict(m);
    expect(v.nniPass).toBe(false);
  });
});

describe("computeNNI — true fabric-mask perimeter (Change A)", () => {
  // A solid NON-square rectangle, inset from the image edges so its 4-connected
  // boundary is a clean ring (2·RW + 2·RH − 4) — hand-computable and != 4·√A.
  const IW = 64, IH = 64, RX = 2, RY = 2, RW = 40, RH = 8;
  const mask = new Uint8Array(IW * IH);
  for (let y = RY; y < RY + RH; y++) for (let x = RX; x < RX + RW; x++) mask[y * IW + x] = 1;
  const area = RW * RH;                       // 320
  const truePerimeter = 2 * RW + 2 * RH - 4;  // 92 (boundary ring)
  const sqApprox = 4 * Math.sqrt(area);       // ~71.55

  // Two centroids 20px apart -> observed mean NN distance = 20.
  const pts: Array<[number, number]> = [[RX + 5, RY + 4], [RX + 25, RY + 4]];

  // NNI under a given perimeter, recomputed from the same Clark-Evans + Donnelly formula.
  const expectedNNI = (perimeter: number) => {
    const n = 2, observedMean = 20;
    const expectedBase = 1 / (2 * Math.sqrt(n / area));
    const donnelly = (0.0514 + 0.041 / Math.sqrt(n)) * perimeter / n;
    return observedMean / (expectedBase + donnelly);
  };

  it("uses the true boundary perimeter, not the 4·√A square approximation", () => {
    expect(truePerimeter).not.toBeCloseTo(sqApprox, 0); // 92 != 71.55 — the masks differ
    const got = computeNNI(pts, mask, IW, IH);
    expect(got).toBeCloseTo(expectedNNI(truePerimeter), 4);             // matches true-P formula
    expect(Math.abs(got - expectedNNI(truePerimeter)))
      .toBeLessThan(Math.abs(got - expectedNNI(sqApprox)));             // not the 4·√A value
  });

  it("shifts NNI in the stricter (smaller) direction vs the old approximation", () => {
    // true P (92) > 4·√A (71.55) -> larger Donnelly term -> larger expected -> smaller NNI.
    expect(computeNNI(pts, mask, IW, IH)).toBeLessThan(expectedNNI(sqApprox));
  });
});

describe("densityVerdict — NNI band gate (Change B), non-regressive by default", () => {
  // Metrics that pass every gate except (optionally) NNI, so v.pass tracks the band.
  const m = (nni: number): DensityMetrics => ({
    measuredRemoval: 0.25, countError: 0, survivorIntegrity: 0, evenness: 0,
    nniDispersion: nni, infillCleanliness: 0, bgDeltaE: 0,
    totalInstances: 64, removedInstances: 16,
  });

  it("CSR-ish (R≈1) passes with defaults", () => {
    expect(densityVerdict(m(1.0)).nniPass).toBe(true);
    expect(densityVerdict(m(1.0)).pass).toBe(true);
  });

  it("near-lattice (R≈2.1) PASSES with default nniMax=Infinity (regression guard)", () => {
    expect(densityVerdict(m(2.1)).nniPass).toBe(true);
    expect(densityVerdict(m(5.0)).nniPass).toBe(true); // no upper cap by default at all
  });

  it("near-lattice (R≈2.1) FAILS once nniMax is capped below it", () => {
    expect(densityVerdict(m(2.1), { nniMax: 1.9 }).nniPass).toBe(false);
    expect(densityVerdict(m(2.1), { nniMax: 1.9 }).pass).toBe(false);
  });

  it("clustered (R<1) fails on the floor", () => {
    expect(densityVerdict(m(0.8)).nniPass).toBe(false);
  });

  it("nniMin raises the floor; legacy nniDispersion still works as the lower bound", () => {
    expect(densityVerdict(m(1.2)).nniPass).toBe(true);                       // default floor 1.0
    expect(densityVerdict(m(1.2), { nniMin: 1.5 }).nniPass).toBe(false);     // raised floor
    expect(densityVerdict(m(1.2), { nniDispersion: 1.5 }).nniPass).toBe(false); // back-compat key
  });

  it("band gate: even-but-not-crystalline window passes, both extremes fail", () => {
    const band = { nniMin: 1.0, nniMax: 1.9 };
    expect(densityVerdict(m(1.4), band).nniPass).toBe(true);  // even
    expect(densityVerdict(m(0.8), band).nniPass).toBe(false); // clustered
    expect(densityVerdict(m(2.1), band).nniPass).toBe(false); // lattice
  });
});
