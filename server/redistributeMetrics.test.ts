/**
 * Density v2 (Option B) metric tests. Runs the real op on a synthetic 6×6 grid and
 * validates the FINAL-position metrics: count, evenness (NNI), palette, per-motif
 * + scale fidelity, ghosting, and the no-op refund guard. decodeUpright mocked.
 *
 * The v1 metric does NOT transfer (it would read ~100% removed once survivors
 * relocate); this asserts the v2 rebuild measures the relocated layout correctly.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./_core/image/decodeUpright", () => ({ decodeUpright: vi.fn() }));
import { decodeUpright } from "./_core/image/decodeUpright";
import { densityRedistribute } from "./_core/studio/ops/densityRedistribute";
import { computeRedistributeMetrics, redistributeVerdict, type RedistributeMetrics } from "./_core/studio/eval/redistributeMetrics";
import type { FabricMask, InstanceMask, RasterMask } from "./_core/masking/types";

// H1: the SHIPPING verdict must reject over-regularization (a crystalline hex lattice,
// NNI ≈ 2.1491), not just clustering — parity with v1 densityVerdict's nniMin/nniMax band.
describe("redistributeVerdict placementEvenness band (H1)", () => {
  const base: RedistributeMetrics = {
    measuredRemoval: 0.3, countError: 0, placementEvenness: 1.4, palette: 0, perMotif: 0,
    scaleFidelity: 0, infillCleanliness: 0, bgDeltaE: 0, totalInstances: 36, presentTargets: 25,
  };
  const withNNI = (nni: number): RedistributeMetrics => ({ ...base, placementEvenness: nni });

  it("no upper cap by default (back-compat): a high NNI still passes evenness", () => {
    expect(redistributeVerdict(withNNI(2.1), 11).evennessPass).toBe(true);
    expect(redistributeVerdict(withNNI(5.0), 11).evennessPass).toBe(true);
  });

  it("placementEvennessMax caps over-regularization (hex lattice R≈2.1 fails once capped)", () => {
    expect(redistributeVerdict(withNNI(2.1), 11, { placementEvennessMax: 1.9 }).evennessPass).toBe(false);
    expect(redistributeVerdict(withNNI(2.1), 11, { placementEvennessMax: 1.9 }).pass).toBe(false);
  });

  it("band gate: even passes, clustered and crystalline both fail", () => {
    const band = { placementEvenness: 1.0, placementEvennessMax: 1.9 };
    expect(redistributeVerdict(withNNI(1.4), 11, band).evennessPass).toBe(true);  // even
    expect(redistributeVerdict(withNNI(0.8), 11, band).evennessPass).toBe(false); // clustered
    expect(redistributeVerdict(withNNI(2.1), 11, band).evennessPass).toBe(false); // lattice
  });
});

const mockDecode = decodeUpright as unknown as ReturnType<typeof vi.fn>;
const W = 128, H = 128, P = 20, OFF = 14, N = 6, R = 8;
const MOTIF = [200, 80, 90];
const groundRGB = (i: number): number[] => [225 + (i % 5) - 2, 220 + (i % 3) - 1, 205];

function scene(): Buffer {
  const b = Buffer.alloc(W * H * 4);
  for (let i = 0; i < W * H; i++) { const p = i * 4; const g = groundRGB(i); b[p] = g[0]; b[p + 1] = g[1]; b[p + 2] = g[2]; b[p + 3] = 255; }
  for (let row = 0; row < N; row++) for (let col = 0; col < N; col++) {
    const cx = OFF + col * P, cy = OFF + row * P;
    for (let y = cy - R; y <= cy + R; y++) for (let x = cx - R; x <= cx + R; x++)
      if ((x - cx) ** 2 + (y - cy) ** 2 <= R * R) { const p = (y * W + x) * 4; b[p] = MOTIF[0]; b[p + 1] = MOTIF[1]; b[p + 2] = MOTIF[2]; }
  }
  return b;
}

const fullRaster = (): RasterMask => ({ width: W, height: H, data: new Uint8Array(W * H).fill(255) });
// SAM2 always emits a boundaryRaster; supply it (full raster = whole image is garment),
// reproducing the prior `?? raster` semantics now that the silent fallback is removed.
const fabric: FabricMask = { bbox: { x: 0, y: 0, w: 1, h: 1 }, confidence: 1, provider: "sam2", raster: fullRaster(), boundaryRaster: fullRaster() };

function buildTruth(): { masks: InstanceMask[]; labels: Int32Array; truthMask: Uint8Array } {
  const masks: InstanceMask[] = [];
  const labels = new Int32Array(W * H).fill(-1);
  let id = 0;
  for (let row = 0; row < N; row++) for (let col = 0; col < N; col++, id++) {
    const cx = OFF + col * P, cy = OFF + row * P;
    const data = new Uint8Array(W * H);
    for (let y = cy - R; y <= cy + R; y++) for (let x = cx - R; x <= cx + R; x++)
      if ((x - cx) ** 2 + (y - cy) ** 2 <= R * R) { data[y * W + x] = 255; labels[y * W + x] = id; }
    masks.push({ bbox: { x: (cx - R) / W, y: (cy - R) / H, w: (2 * R + 1) / W, h: (2 * R + 1) / H }, raster: { width: W, height: H, data } });
  }
  return { masks, labels, truthMask: new Uint8Array(W * H).fill(1) };
}

beforeEach(() => { mockDecode.mockImplementation(async () => ({ buffer: scene(), width: W, height: H })); });

describe("computeRedistributeMetrics", () => {
  it("verdict passes on a clean composite redistribution (count, evenness, palette, motif, scale, ghosting)", async () => {
    const { masks, labels, truthMask } = buildTruth();
    const res = await densityRedistribute({ image: { url: "x" }, fabric, instances: masks, percent: 30 });
    expect(res.removed).toBe(11);

    const m = computeRedistributeMetrics({
      source: scene(), out: res.data, width: W, height: H,
      truthMask, truthInstanceLabels: labels,
      targets: res.targets, assignments: res.assignments, removed: res.removed,
      targetRemovalFraction: 0.30,
    });

    expect(m.totalInstances).toBe(36);
    expect(m.presentTargets).toBe(25);
    expect(m.countError).toBeLessThanOrEqual(0.10);
    expect(m.placementEvenness).toBeGreaterThanOrEqual(1.0); // even (blue-noise) layout
    expect(m.palette).toBeLessThanOrEqual(5);
    expect(m.perMotif).toBeLessThanOrEqual(3);
    expect(m.scaleFidelity).toBeLessThanOrEqual(0.05);
    expect(m.infillCleanliness).toBeLessThanOrEqual(2.5);

    const v = redistributeVerdict(m, res.removed);
    expect(v.pass).toBe(true);
  });

  it("the no-op refund guard fails the verdict when removed === 0", async () => {
    const { masks, labels, truthMask } = buildTruth();
    const res = await densityRedistribute({ image: { url: "x" }, fabric, instances: masks, percent: 30 });
    const m = computeRedistributeMetrics({
      source: scene(), out: res.data, width: W, height: H,
      truthMask, truthInstanceLabels: labels,
      targets: res.targets, assignments: res.assignments, removed: res.removed,
      targetRemovalFraction: 0.30,
    });
    // Same metrics, but assert the op-level no-op contract: removed 0 => not a pass.
    expect(redistributeVerdict(m, 0).noopPass).toBe(false);
    expect(redistributeVerdict(m, 0).pass).toBe(false);
  });
});
