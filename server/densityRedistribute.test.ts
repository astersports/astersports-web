/**
 * Density op v2 (Option B) tests. Synthetic 6×6 motif grid (36 instances, raster
 * each) on textured ground in a full-fabric raster. Validates the count contract,
 * relocation (survivors are NOT byte-identical — v2 drops that invariant), the
 * no-op/refund guards, and determinism. decodeUpright mocked (the op + infill read it).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./_core/image/decodeUpright", () => ({ decodeUpright: vi.fn() }));
import { decodeUpright } from "./_core/image/decodeUpright";
import { densityRedistribute } from "./_core/studio/ops/densityRedistribute";
import type { FabricMask, InstanceMask, RasterMask } from "./_core/masking/types";

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
// SAM2 always emits a boundaryRaster (garment silhouette); mirror that here. The
// full raster as boundary reproduces the prior `?? raster` semantics so the count /
// relocation assertions are unchanged. (Fix 3 removed the silent full-crop fallback.)
const fabric: FabricMask = { bbox: { x: 0, y: 0, w: 1, h: 1 }, confidence: 1, provider: "sam2", raster: fullRaster(), boundaryRaster: fullRaster() };

function instances(): InstanceMask[] {
  const masks: InstanceMask[] = [];
  for (let row = 0; row < N; row++) for (let col = 0; col < N; col++) {
    const cx = OFF + col * P, cy = OFF + row * P;
    const data = new Uint8Array(W * H);
    for (let y = cy - R; y <= cy + R; y++) for (let x = cx - R; x <= cx + R; x++)
      if ((x - cx) ** 2 + (y - cy) ** 2 <= R * R) data[y * W + x] = 255;
    masks.push({ bbox: { x: (cx - R) / W, y: (cy - R) / H, w: (2 * R + 1) / W, h: (2 * R + 1) / H }, raster: { width: W, height: H, data } });
  }
  return masks;
}

beforeEach(() => { mockDecode.mockImplementation(async () => ({ buffer: scene(), width: W, height: H })); });

describe("densityRedistribute (Option B)", () => {
  it("removes round(p·N) and keeps the rest (count contract)", async () => {
    const res = await densityRedistribute({ image: { url: "x" }, fabric, instances: instances(), percent: 30 });
    expect(res.removed).toBe(11); // round(36 * 0.30)
    expect(res.kept).toBe(25);
    expect(res.removed + res.kept).toBe(36);
    expect(res.targets.length).toBe(25);
    expect(res.assignments.length).toBe(25);
  });

  it("relocates survivors — output is NOT byte-identical to source (v2 drops the unmoved invariant)", async () => {
    const res = await densityRedistribute({ image: { url: "x" }, fabric, instances: instances(), percent: 30 });
    expect(Buffer.compare(res.data, scene())).not.toBe(0);
  });

  it("is deterministic", async () => {
    const a = (await densityRedistribute({ image: { url: "x" }, fabric, instances: instances(), percent: 30 })).data;
    const b = (await densityRedistribute({ image: { url: "x" }, fabric, instances: instances(), percent: 30 })).data;
    expect(Buffer.compare(a, b)).toBe(0);
  });

  it("passthrough on percent 0 and on empty instances (removed === 0, byte-identical)", async () => {
    const a = await densityRedistribute({ image: { url: "x" }, fabric, instances: instances(), percent: 0 });
    expect(a.removed).toBe(0);
    expect(a.kept).toBe(36); // no-op keeps all N present (removed + kept === N)
    expect(Buffer.compare(a.data, scene())).toBe(0);
    const b = await densityRedistribute({ image: { url: "x" }, fabric, instances: [], percent: 30 });
    expect(b.removed).toBe(0);
    expect(b.kept).toBe(0); // no instances -> nothing kept
  });

  it("never relocates on a no-removal rounding (removeN === 0 -> refund)", async () => {
    // 1 instance at 30% -> round(0.3) = 0 -> no removal -> passthrough.
    const one = [instances()[0]];
    const res = await densityRedistribute({ image: { url: "x" }, fabric, instances: one, percent: 30 });
    expect(res.removed).toBe(0);
    expect(Buffer.compare(res.data, scene())).toBe(0);
  });

  it("throws when fabric.raster is absent", async () => {
    await expect(
      densityRedistribute({ image: { url: "x" }, fabric: { bbox: { x: 0, y: 0, w: 1, h: 1 }, confidence: 1, provider: "classical" }, instances: instances(), percent: 30 })
    ).rejects.toThrow(/raster/);
  });

  it("no bare ground to sample (fully covered fabric) -> removed 0, byte-identical (F2 refund)", async () => {
    const d = new Uint8Array(W * H);
    for (let y = 40; y < 60; y++) for (let x = 40; x < 60; x++) d[y * W + x] = 255;
    const fab: FabricMask = { bbox: { x: 40 / W, y: 40 / H, w: 20 / W, h: 20 / H }, confidence: 1, provider: "sam2", raster: { width: W, height: H, data: Uint8Array.from(d) }, boundaryRaster: { width: W, height: H, data: Uint8Array.from(d) } };
    const inst: InstanceMask = { bbox: fab.bbox, raster: { width: W, height: H, data: Uint8Array.from(d) } };
    const res = await densityRedistribute({ image: { url: "x" }, fabric: fab, instances: [inst, inst], percent: 50 });
    expect(res.removed).toBe(0);
    expect(Buffer.compare(res.data, scene())).toBe(0);
  });

  // Fix 3 (Pillar 1): a sam2 fabric missing its boundaryRaster, or with an all-zero
  // (degenerate) one, must DEGRADE -> refund rather than silently using the full-crop
  // raster as the garment boundary (which would composite motifs onto background).
  it("Fix 3: boundaryRaster absent (sam2, raster present) -> degrade refund, byte-identical", async () => {
    const noBoundary: FabricMask = { bbox: { x: 0, y: 0, w: 1, h: 1 }, confidence: 1, provider: "sam2", raster: fullRaster() };
    const res = await densityRedistribute({ image: { url: "x" }, fabric: noBoundary, instances: instances(), percent: 30 });
    expect(res.removed).toBe(0);
    expect(Buffer.compare(res.data, scene())).toBe(0);
  });

  it("Fix 3: all-zero boundaryRaster (degenerate silhouette) -> degrade refund, byte-identical", async () => {
    const zeroBoundary: FabricMask = { bbox: { x: 0, y: 0, w: 1, h: 1 }, confidence: 1, provider: "sam2", raster: fullRaster(), boundaryRaster: { width: W, height: H, data: new Uint8Array(W * H) } };
    const res = await densityRedistribute({ image: { url: "x" }, fabric: zeroBoundary, instances: instances(), percent: 30 });
    expect(res.removed).toBe(0);
    expect(Buffer.compare(res.data, scene())).toBe(0);
  });

  // T1.1 (GAP-1): boundaryRaster dimension mismatch -> degrade refund.
  // This closes the one reachable path to a silently corrupted PAID image that still bills.
  it("T1.1: boundaryRaster dimension mismatch -> degrade refund, byte-identical (not composite)", async () => {
    // Boundary is 64x64 but image is 128x128 — a mis-sized remap from the SAM provider.
    const misSized: FabricMask = {
      bbox: { x: 0, y: 0, w: 1, h: 1 },
      confidence: 1,
      provider: "sam2",
      raster: fullRaster(),
      boundaryRaster: { width: 64, height: 64, data: new Uint8Array(64 * 64).fill(255) },
    };
    const res = await densityRedistribute({ image: { url: "x" }, fabric: misSized, instances: instances(), percent: 30 });
    // Must NOT composite — removed === 0 means the caller refunds.
    expect(res.removed).toBe(0);
    expect(res.kept).toBe(36); // passthrough keeps all N
    expect(Buffer.compare(res.data, scene())).toBe(0);
  });

  it("T1.1: boundaryRaster with correct dims proceeds normally (not a false positive)", async () => {
    // Correct dims — should actually redistribute.
    const res = await densityRedistribute({ image: { url: "x" }, fabric, instances: instances(), percent: 30 });
    expect(res.removed).toBe(11);
    expect(res.kept).toBe(25);
  });

  it("size-tiered: emphasises main blooms — secondary bits removed at a higher rate (total unchanged)", async () => {
    const disk = (cx: number, cy: number, rad: number): InstanceMask => {
      const data = new Uint8Array(W * H);
      for (let y = cy - rad; y <= cy + rad; y++)
        for (let x = cx - rad; x <= cx + rad; x++)
          if (x >= 0 && x < W && y >= 0 && y < H && (x - cx) ** 2 + (y - cy) ** 2 <= rad * rad) data[y * W + x] = 255;
      return { bbox: { x: (cx - rad) / W, y: (cy - rad) / H, w: (2 * rad + 1) / W, h: (2 * rad + 1) / H }, raster: { width: W, height: H, data } };
    };
    // 4 large blooms (idx 0-3) + 12 small bits (idx 4-15). At 50% (removeN=8) the bits
    // should be thinned more than the blooms, while total removed stays 8.
    const big = [disk(24, 24, 10), disk(104, 24, 10), disk(24, 104, 10), disk(104, 104, 10)];
    const small: InstanceMask[] = [];
    for (let i = 0; i < 12; i++) small.push(disk(20 + (i % 4) * 30, 50 + Math.floor(i / 4) * 12, 3));
    const res = await densityRedistribute({ image: { url: "x" }, fabric, instances: [...big, ...small], percent: 50 });

    expect(res.removed).toBe(8); // round(16 * 0.5) — total reduction (billing) unchanged
    const survBig = res.assignments.filter((a) => a.source < 4).length;
    const survSmall = res.assignments.filter((a) => a.source >= 4).length;
    expect(survBig + survSmall).toBe(8); // kept = 16 - 8
    expect(survBig / 4).toBeGreaterThan(survSmall / 12); // blooms kept at a higher fraction than bits
  });
});
