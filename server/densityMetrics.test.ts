/**
 * Density eval-metric tests. Synthetic motif grid (64 instances) on textured
 * ground with truth instance labels. Even (stratified) vs clustered removal (R2),
 * count accuracy (R1), survivor integrity, infill, and bg-excluded-from-pass.
 */
import { describe, it, expect } from "vitest";
import { computeDensityMetrics, densityVerdict, type DensityMetricInput } from "./_core/studio/eval/densityMetrics";

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
});
