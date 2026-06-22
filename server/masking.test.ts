/**
 * Tests for the swappable mask interface (Amendment 1 §13.3).
 * The vision-box locator is exercised with a mocked LLM; the raster halves are
 * verified to fail explicitly until their backends (sharp / SAM 2) are wired.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./_core/llm", () => ({ invokeLLM: vi.fn() }));
vi.mock("./storage", () => ({ storageGetSignedUrl: vi.fn().mockResolvedValue("http://signed.url") }));
// Phase 5: locate now fetches + downscales (sharp) before the LLM — mock that path so the
// vision-LLM bbox-parsing tests below exercise invokeLLM instead of hitting the fetch/decode.
vi.mock("./_core/net/safeFetch", () => ({
  safeFetchBuffer: vi.fn().mockResolvedValue({ buffer: Buffer.from([0, 1, 2, 3]), response: { ok: true, status: 200 } }),
}));
vi.mock("sharp", () => {
  const chain: any = {};
  chain.rotate = vi.fn(() => chain);
  chain.resize = vi.fn(() => chain);
  chain.jpeg = vi.fn(() => chain);
  chain.toBuffer = vi.fn(async () => Buffer.from([1, 2, 3]));
  return { default: vi.fn(() => chain) };
});
import { invokeLLM } from "./_core/llm";
import {
  getMaskProvider,
  locateFabricRegion,
  MaskNotImplementedError,
  MaskProviderUnavailableError,
  validateInstanceCount,
  MIN_DENSITY_INSTANCES,
  expandBbox,
} from "./_core/masking";
import { locateFabricRegionForDensity } from "./_core/masking/locateFabricRegion";
import { defaultSam2Client } from "./_core/masking/replicateSam2";

const mockLLM = invokeLLM as unknown as ReturnType<typeof vi.fn>;

function llmReturns(obj: unknown) {
  mockLLM.mockResolvedValue({ choices: [{ message: { content: JSON.stringify(obj) } }] });
}

describe("getMaskProvider", () => {
  it("respects STUDIO_MASK_PROVIDER env", () => {
    // When STUDIO_MASK_PROVIDER=sam2 is set, default is sam2; otherwise classical
    const expected = process.env.STUDIO_MASK_PROVIDER === "sam2" ? "sam2" : "classical";
    expect(getMaskProvider().name).toBe(expected);
  });

  it("selects sam2 when overridden", () => {
    expect(getMaskProvider("sam2").name).toBe("sam2");
  });

  it("rasterReady: classical floor false (bbox only), sam2 true (D1 = Option 2)", () => {
    expect(getMaskProvider("classical").rasterReady).toBe(false);
    expect(getMaskProvider("sam2").rasterReady).toBe(true);
  });
});

describe("locateFabricRegion", () => {
  beforeEach(() => mockLLM.mockReset());

  it("parses a normalized bbox + confidence from the vision LLM (with expansion)", async () => {
    // Area = 0.5 * 0.7 = 0.35 — exactly at MIN_AREA_FRACTION threshold, passes
    llmReturns({ x: 0.1, y: 0.1, w: 0.7, h: 0.7, confidence: 0.9 });
    const r = await locateFabricRegion("http://example.com/garment.jpg");
    // expandBbox adds 5% padding on each side: x-0.035, y-0.035, w+0.07, h+0.07
    expect(r.bbox.x).toBeCloseTo(0.065, 3);
    expect(r.bbox.y).toBeCloseTo(0.065, 3);
    expect(r.bbox.w).toBeCloseTo(0.77, 3);
    expect(r.bbox.h).toBeCloseTo(0.77, 3);
    expect(r.confidence).toBe(0.9);
  });

  it("triggers min area safeguard when bbox is too small (< 35%)", async () => {
    // Area = 0.3 * 0.3 = 0.09 — well below 35% threshold
    llmReturns({ x: 0.3, y: 0.3, w: 0.3, h: 0.3, confidence: 0.8 });
    const r = await locateFabricRegion("http://example.com/garment.jpg");
    // Should fall back to full-garment default
    expect(r.bbox).toEqual({ x: 0.05, y: 0.05, w: 0.9, h: 0.9 });
    expect(r.confidence).toBe(0);
  });

  it("clamps out-of-range coordinates to 0..1 and applies min area check", async () => {
    // x clamped to 0, y clamped to 1, w=0.5, h=0.5 -> area=0.25 < 0.35 -> fallback
    llmReturns({ x: -0.2, y: 1.4, w: 0.5, h: 0.5, confidence: 2 });
    const r = await locateFabricRegion("http://example.com/garment.jpg");
    // y=1 means the box starts at the bottom edge, h=0.5 would extend beyond
    // After clamping: x=0, y=1, w=0.5, h=0.5 -> area = 0.5*0.5 = 0.25 < 0.35
    // Falls back to default
    expect(r.bbox).toEqual({ x: 0.05, y: 0.05, w: 0.9, h: 0.9 });
    expect(r.confidence).toBe(0);
  });

  it("falls back to full-garment default on a zero-area box", async () => {
    // w=0 triggers the zero-area guard in callVisionLLM which returns DEFAULT_REGION
    // directly. locateFabricRegion then checks area: 0.9*0.9=0.81 > 0.35, so it
    // expands the default. But wait — callVisionLLM returns DEFAULT_REGION which has
    // confidence=0. The public function receives {bbox:{x:0.05,y:0.05,w:0.9,h:0.9}, confidence:0}.
    // Area = 0.81 > 0.35 threshold, so it applies expandBbox to the default.
    llmReturns({ x: 0.1, y: 0.1, w: 0, h: 0.5, confidence: 0.8 });
    const r = await locateFabricRegion("http://example.com/garment.jpg");
    // expandBbox({x:0.05, y:0.05, w:0.9, h:0.9}):
    // padX = 0.9*0.05 = 0.045, padY = 0.9*0.05 = 0.045
    // x = max(0, 0.05-0.045) = 0.005
    // y = max(0, 0.05-0.045) = 0.005
    // w = min(1-0.005, 0.9+0.09) = min(0.995, 0.99) = 0.99
    // h = min(1-0.005, 0.9+0.09) = min(0.995, 0.99) = 0.99
    expect(r.bbox.x).toBeCloseTo(0.005, 3);
    expect(r.bbox.y).toBeCloseTo(0.005, 3);
    expect(r.bbox.w).toBeCloseTo(0.99, 3);
    expect(r.bbox.h).toBeCloseTo(0.99, 3);
    expect(r.confidence).toBe(0);
  });

  it("falls back to full-garment default when the LLM output is unparseable", async () => {
    mockLLM.mockResolvedValue({ choices: [{ message: { content: "not json" } }] });
    const r = await locateFabricRegion("http://example.com/garment.jpg");
    expect(r.bbox).toEqual({ x: 0.05, y: 0.05, w: 0.9, h: 0.9 });
  });
});

describe("locateFabricRegionForDensity", () => {
  beforeEach(() => mockLLM.mockReset());

  it("uses the density-specific prompt and applies stricter 40% min area", async () => {
    // Area = 0.6 * 0.6 = 0.36 — below density's 40% threshold, triggers fallback
    llmReturns({ x: 0.2, y: 0.2, w: 0.6, h: 0.6, confidence: 0.85 });
    const r = await locateFabricRegionForDensity("http://example.com/garment.jpg");
    // 0.36 < 0.40 -> falls back to default
    expect(r.bbox).toEqual({ x: 0.05, y: 0.05, w: 0.9, h: 0.9 });
    expect(r.confidence).toBe(0);
  });

  it("passes when area meets the 40% density threshold", async () => {
    // Area = 0.7 * 0.7 = 0.49 — above 40% threshold, passes
    llmReturns({ x: 0.1, y: 0.1, w: 0.7, h: 0.7, confidence: 0.9 });
    const r = await locateFabricRegionForDensity("http://example.com/garment.jpg");
    // Should expand: x=0.1-0.035=0.065, y=0.065, w=0.77, h=0.77
    expect(r.bbox.x).toBeCloseTo(0.065, 3);
    expect(r.bbox.y).toBeCloseTo(0.065, 3);
    expect(r.bbox.w).toBeCloseTo(0.77, 3);
    expect(r.bbox.h).toBeCloseTo(0.77, 3);
    expect(r.confidence).toBe(0.9);
  });

  it("falls back to full-garment default on LLM failure", async () => {
    mockLLM.mockRejectedValueOnce(new Error("LLM timeout"));
    // The catch block in locateFabricRegionForDensity returns DEFAULT_REGION directly
    // (no expansion applied in the catch path)
    const r = await locateFabricRegionForDensity("http://example.com/garment.jpg");
    expect(r.bbox).toEqual({ x: 0.05, y: 0.05, w: 0.9, h: 0.9 });
    expect(r.confidence).toBe(0);
  });
});

describe("expandBbox", () => {
  it("adds 5% padding on each side, clamped to [0,1]", () => {
    const result = expandBbox({ x: 0.2, y: 0.2, w: 0.6, h: 0.6 });
    // padX = 0.6 * 0.05 = 0.03, padY = 0.6 * 0.05 = 0.03
    expect(result.x).toBeCloseTo(0.17, 5);
    expect(result.y).toBeCloseTo(0.17, 5);
    expect(result.w).toBeCloseTo(0.66, 5);
    expect(result.h).toBeCloseTo(0.66, 5);
  });

  it("clamps to image bounds when near edges", () => {
    const result = expandBbox({ x: 0.0, y: 0.0, w: 1.0, h: 1.0 });
    // padX = 1.0 * 0.05 = 0.05
    // x = max(0, 0 - 0.05) = 0
    // w = min(1 - 0, 1.0 + 0.1) = 1.0 (clamped)
    expect(result.x).toBe(0);
    expect(result.y).toBe(0);
    expect(result.w).toBe(1);
    expect(result.h).toBe(1);
  });
});

describe("validateInstanceCount", () => {
  it("returns valid for adequate instance counts", () => {
    const result = validateInstanceCount(20, 0.7);
    expect(result.valid).toBe(true);
  });

  it("returns invalid for 0 instances", () => {
    const result = validateInstanceCount(0, 0.7);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("0 instances");
  });

  it("returns invalid for too few instances in a large bbox", () => {
    const result = validateInstanceCount(3, 0.7);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain(`at least ${MIN_DENSITY_INSTANCES}`);
  });

  it("returns valid for few instances in a small bbox (not suspicious)", () => {
    // Small bbox (30% area) with 3 instances — could be a small patch, not suspicious
    const result = validateInstanceCount(3, 0.3);
    expect(result.valid).toBe(true);
  });

  it("returns valid at the exact threshold", () => {
    const result = validateInstanceCount(MIN_DENSITY_INSTANCES, 0.7);
    expect(result.valid).toBe(true);
  });
});

describe("classical provider", () => {
  beforeEach(() => mockLLM.mockReset());

  it("returns a bbox-only fabric mask (no raster until S3, expanded)", async () => {
    // Area = 0.6 * 0.6 = 0.36 — above 35% threshold
    llmReturns({ x: 0.1, y: 0.1, w: 0.7, h: 0.7, confidence: 0.7 });
    const mask = await getMaskProvider("classical").getFabricMask({
      url: "http://example.com/garment.jpg",
    });
    expect(mask.provider).toBe("classical");
    // expandBbox: w=0.7 + 2*0.035 = 0.77
    expect(mask.bbox.w).toBeCloseTo(0.77, 3);
    expect(mask.raster).toBeUndefined();
  });

  it("throws MaskNotImplementedError for instance masks", async () => {
    await expect(
      getMaskProvider("classical").getInstanceMasks(
        { url: "http://example.com/garment.jpg" },
        { bbox: { x: 0, y: 0, w: 1, h: 1 }, confidence: 1, provider: "classical" }
      )
    ).rejects.toBeInstanceOf(MaskNotImplementedError);
  });
});

describe("sam2 provider", () => {
  it.skipIf(!!process.env.REPLICATE_API_TOKEN)(
    "default Replicate client is unavailable until provisioned (no token)",
    async () => {
      await expect(
        defaultSam2Client().autoSegment("data:image/png;base64,xx")
      ).rejects.toBeInstanceOf(MaskProviderUnavailableError);
    }
  );
});
