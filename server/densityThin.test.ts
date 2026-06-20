/**
 * Density op v1 tests. Synthetic motif grid (36 instances, each with a raster) on
 * textured ground. Removal validated by the landed densityMetrics (count R1,
 * stratified evenness R2), survivors byte-identical, determinism. decodeUpright is
 * mocked (both thinDensity and infillBaseCloth read through it).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./_core/image/decodeUpright", () => ({ decodeUpright: vi.fn() }));
import { decodeUpright } from "./_core/image/decodeUpright";
import { thinDensity } from "./_core/studio/ops/densityThin";
import { computeDensityMetrics, densityVerdict } from "./_core/studio/eval/densityMetrics";
import type { InstanceMask } from "./_core/masking/types";

const mockDecode = decodeUpright as unknown as ReturnType<typeof vi.fn>;
const W = 128, H = 128, P = 20, OFF = 10, N = 6, R = 7;
const MOTIF = [200, 80, 90];
const groundRGB = (i: number): number[] => [225 + (i % 5) - 2, 220 + (i % 3) - 1, 205];

function scene(): Buffer {
  const b = Buffer.alloc(W * H * 4);
  for (let i = 0; i < W * H; i++) { const p = i * 4; const g = groundRGB(i); b[p] = g[0]; b[p + 1] = g[1]; b[p + 2] = g[2]; b[p + 3] = 255; }
  for (let row = 0; row < N; row++) for (let col = 0; col < N; col++) {
    const cx = OFF + col * P, cy = OFF + row * P;
    for (let y = cy - R; y <= cy + R; y++) for (let x = cx - R; x <= cx + R; x++)
      if ((x - cx) ** 2 + (y - cy) ** 2 <= R * R && x >= 0 && x < W && y >= 0 && y < H) {
        const p = (y * W + x) * 4; b[p] = MOTIF[0]; b[p + 1] = MOTIF[1]; b[p + 2] = MOTIF[2];
      }
  }
  return b;
}

function instances(): { masks: InstanceMask[]; labels: Int32Array } {
  const masks: InstanceMask[] = [];
  const labels = new Int32Array(W * H).fill(-1);
  let id = 0;
  for (let row = 0; row < N; row++) for (let col = 0; col < N; col++, id++) {
    const cx = OFF + col * P, cy = OFF + row * P;
    const data = new Uint8Array(W * H);
    for (let y = cy - R; y <= cy + R; y++) for (let x = cx - R; x <= cx + R; x++)
      if ((x - cx) ** 2 + (y - cy) ** 2 <= R * R && x >= 0 && x < W && y >= 0 && y < H) { data[y * W + x] = 255; labels[y * W + x] = id; }
    masks.push({ bbox: { x: (cx - R) / W, y: (cy - R) / H, w: (2 * R + 1) / W, h: (2 * R + 1) / H }, raster: { width: W, height: H, data } });
  }
  return { masks, labels };
}

const FULL = new Uint8Array(W * H).fill(1);
beforeEach(() => { mockDecode.mockImplementation(async () => ({ buffer: scene(), width: W, height: H })); });

describe("thinDensity", () => {
  it("removes ~X% of instances by count, evenly, survivors intact (R1/R2)", async () => {
    const { masks, labels } = instances();
    const { data: out } = await thinDensity({ image: { url: "x" }, instances: masks, removalFraction: 0.25 });
    const m = computeDensityMetrics({
      source: scene(), out, width: W, height: H, truthMask: FULL,
      truthInstanceLabels: labels, targetRemovalFraction: 0.25,
    });
    expect(m.totalInstances).toBe(36);
    expect(m.countError).toBeLessThanOrEqual(0.10);
    expect(m.survivorIntegrity).toBeLessThanOrEqual(2);
    const v = densityVerdict(m);
    expect(v.evennessPass).toBe(true);
    expect(v.pass).toBe(true);
  });

  it("is deterministic (identical bytes, no RNG)", async () => {
    const { masks } = instances();
    const a = (await thinDensity({ image: { url: "x" }, instances: masks, removalFraction: 0.25 })).data;
    const b = (await thinDensity({ image: { url: "x" }, instances: masks, removalFraction: 0.25 })).data;
    expect(Buffer.compare(a, b)).toBe(0);
  });

  it("removalFraction 0 is a passthrough", async () => {
    const { masks } = instances();
    const { data: out } = await thinDensity({ image: { url: "x" }, instances: masks, removalFraction: 0 });
    expect(Buffer.compare(out, scene())).toBe(0);
  });

  it("erases the selected instances toward ground", async () => {
    const { masks, labels } = instances();
    const { data: out } = await thinDensity({ image: { url: "x" }, instances: masks, removalFraction: 0.5 });
    const m = computeDensityMetrics({
      source: scene(), out, width: W, height: H, truthMask: FULL,
      truthInstanceLabels: labels, targetRemovalFraction: 0.5,
    });
    expect(m.removedInstances).toBeGreaterThanOrEqual(16); // ~18 of 36
    expect(m.removedInstances).toBeLessThanOrEqual(20);
  });
});
