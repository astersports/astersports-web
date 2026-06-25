/**
 * Density PREVIEW tests (Phase 1, 10/20/50%). Reuses the densityThin synthetic
 * 36-motif grid. Asserts the preview's count semantics ("% drop = % fewer motifs"),
 * truthfulness vs the billed op, determinism, and no-op honesty.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./_core/image/decodeUpright", () => ({ decodeUpright: vi.fn() }));
import { decodeUpright } from "./_core/image/decodeUpright";
import { densityThin } from "./_core/studio/ops/densityThin";
import {
  densityPreview,
  summarizePreviewStep,
  DEFAULT_PREVIEW_PERCENTS,
} from "./_core/studio/ops/densityPreview";
import type { FabricMask, InstanceMask, RasterMask } from "./_core/masking/types";

const mockDecode = decodeUpright as unknown as ReturnType<typeof vi.fn>;
const W = 128, H = 128, P = 20, OFF = 10, N = 6, R = 8;
const MOTIF = [200, 80, 90];
const groundRGB = (i: number): number[] => [225 + (i % 5) - 2, 220 + (i % 3) - 1, 205];
const F0 = 6, F1 = 122;

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
function fabricRaster(): RasterMask {
  const data = new Uint8Array(W * H);
  for (let y = F0; y < F1; y++) for (let x = F0; x < F1; x++) data[y * W + x] = 255;
  return { width: W, height: H, data };
}
const fabric: FabricMask = { bbox: { x: F0 / W, y: F0 / H, w: (F1 - F0) / W, h: (F1 - F0) / H }, confidence: 1, provider: "sam2", raster: fabricRaster() };
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

describe("densityPreview (Phase 1 10/20/50%)", () => {
  it("defaults to 10/20/50 with exact count semantics (round(N*p/100))", async () => {
    const r = await densityPreview({ image: { url: "x" }, fabric, instances: instances() });
    expect(r.totalMotifs).toBe(36);
    expect(r.steps.map((s) => s.percent)).toEqual([10, 20, 50]);
    // requested = round(36 * p/100): 10%->4, 20%->7, 50%->18
    expect(r.steps.map((s) => s.requestedRemoval)).toEqual([4, 7, 18]);
    // on the happy path the op removes exactly the requested count
    expect(r.steps.map((s) => s.removed)).toEqual([4, 7, 18]);
    expect(r.steps.map((s) => s.kept)).toEqual([32, 29, 18]);
    expect(r.steps.every((s) => !s.noop)).toBe(true);
  });

  it("each preview step is byte-identical to the billed densityThin at that percent (truthful)", async () => {
    const masks = instances();
    const r = await densityPreview({ image: { url: "x" }, fabric, instances: masks });
    for (const s of r.steps) {
      const billed = await densityThin({ image: { url: "x" }, fabric, instances: masks, percent: s.percent });
      expect(Buffer.compare(s.data, billed.data)).toBe(0);
      expect(s.removed).toBe(billed.removed);
    }
  });

  it("is deterministic across runs", async () => {
    const a = await densityPreview({ image: { url: "x" }, fabric, instances: instances() });
    const b = await densityPreview({ image: { url: "x" }, fabric, instances: instances() });
    for (let i = 0; i < a.steps.length; i++) expect(Buffer.compare(a.steps[i].data, b.steps[i].data)).toBe(0);
  });

  it("original reference is the unmodified source", async () => {
    const r = await densityPreview({ image: { url: "x" }, fabric, instances: instances() });
    expect(Buffer.compare(r.original, scene())).toBe(0);
  });

  it("honest no-op: degrade (missing raster instances) reports removed 0 + noop, never a phantom removal", async () => {
    // instances without rasters -> densityThin dim-drift degrade -> removed 0
    const bare: InstanceMask[] = instances().map((m) => ({ bbox: m.bbox }));
    const r = await densityPreview({ image: { url: "x" }, fabric, instances: bare, percents: [50] });
    expect(r.steps[0].requestedRemoval).toBe(18); // we still asked for 18
    expect(r.steps[0].removed).toBe(0); // but nothing was erased
    expect(r.steps[0].noop).toBe(true);
    expect(Buffer.compare(r.steps[0].data, scene())).toBe(0);
    expect(summarizePreviewStep(r.steps[0])).toMatch(/REMOVED 0 \(no-op\/refund\)/);
  });

  it("empty instances -> totalMotifs 0, every step a no-op", async () => {
    const r = await densityPreview({ image: { url: "x" }, fabric, instances: [] });
    expect(r.totalMotifs).toBe(0);
    expect(r.steps.every((s) => s.removed === 0 && s.kept === 0 && s.noop)).toBe(true);
  });

  it("clamps percents to 0..90 and rounds", async () => {
    const r = await densityPreview({ image: { url: "x" }, fabric, instances: instances(), percents: [150, -5, 33.4] });
    expect(r.steps.map((s) => s.percent)).toEqual([90, 0, 33]);
  });

  it("summary line reads as exact counts on the happy path", async () => {
    const r = await densityPreview({ image: { url: "x" }, fabric, instances: instances(), percents: [50] });
    expect(summarizePreviewStep(r.steps[0])).toBe("36 motifs · −50% → remove 18 · 18 remain");
  });

  it("exposes the asked-for default percents constant", () => {
    expect([...DEFAULT_PREVIEW_PERCENTS]).toEqual([10, 20, 50]);
  });
});
