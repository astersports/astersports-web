/**
 * Tests for the swappable mask interface (Amendment 1 §13.3).
 * The vision-box locator is exercised with a mocked LLM; the raster halves are
 * verified to fail explicitly until their backends (sharp / SAM 2) are wired.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./_core/llm", () => ({ invokeLLM: vi.fn() }));
import { invokeLLM } from "./_core/llm";
import {
  getMaskProvider,
  locateFabricRegion,
  MaskNotImplementedError,
  MaskProviderUnavailableError,
} from "./_core/masking";
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
    llmReturns({ x: 0.25, y: 0.3, w: 0.5, h: 0.4, confidence: 0.9 });
    const r = await locateFabricRegion("http://example.com/garment.jpg");
    // expandBbox adds 5% padding on each side: x-0.025, y-0.02, w+0.05, h+0.04
    expect(r.bbox.x).toBeCloseTo(0.225, 5);
    expect(r.bbox.y).toBeCloseTo(0.28, 5);
    expect(r.bbox.w).toBeCloseTo(0.55, 5);
    expect(r.bbox.h).toBeCloseTo(0.44, 5);
    expect(r.confidence).toBe(0.9);
  });

  it("clamps out-of-range coordinates to 0..1 (with expansion)", async () => {
    llmReturns({ x: -0.2, y: 1.4, w: 0.5, h: 0.5, confidence: 2 });
    const r = await locateFabricRegion("http://example.com/garment.jpg");
    // x clamped to 0, then expanded: max(0, 0 - 0.025) = 0
    expect(r.bbox.x).toBe(0);
    // y clamped to 1, then expanded: max(0, 1 - 0.025) = 0.975
    expect(r.bbox.y).toBeCloseTo(0.975, 5);
    expect(r.confidence).toBe(1);
  });

  it("falls back to full-garment default on a zero-area box", async () => {
    llmReturns({ x: 0.1, y: 0.1, w: 0, h: 0.5, confidence: 0.8 });
    const r = await locateFabricRegion("http://example.com/garment.jpg");
    expect(r.bbox).toEqual({ x: 0.05, y: 0.05, w: 0.9, h: 0.9 });
    expect(r.confidence).toBe(0);
  });

  it("falls back to full-garment default when the LLM output is unparseable", async () => {
    mockLLM.mockResolvedValue({ choices: [{ message: { content: "not json" } }] });
    const r = await locateFabricRegion("http://example.com/garment.jpg");
    expect(r.bbox).toEqual({ x: 0.05, y: 0.05, w: 0.9, h: 0.9 });
  });
});

describe("classical provider", () => {
  beforeEach(() => mockLLM.mockReset());

  it("returns a bbox-only fabric mask (no raster until S3, expanded)", async () => {
    llmReturns({ x: 0.2, y: 0.2, w: 0.6, h: 0.6, confidence: 0.7 });
    const mask = await getMaskProvider("classical").getFabricMask({
      url: "http://example.com/garment.jpg",
    });
    expect(mask.provider).toBe("classical");
    // expandBbox: w=0.6 + 2*0.03 = 0.66
    expect(mask.bbox.w).toBeCloseTo(0.66, 5);
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
