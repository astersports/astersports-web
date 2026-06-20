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
  it("defaults to the classical floor", () => {
    expect(getMaskProvider().name).toBe("classical");
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

  it("parses a normalized bbox + confidence from the vision LLM", async () => {
    llmReturns({ x: 0.25, y: 0.3, w: 0.5, h: 0.4, confidence: 0.9 });
    const r = await locateFabricRegion("http://example.com/garment.jpg");
    expect(r.bbox).toEqual({ x: 0.25, y: 0.3, w: 0.5, h: 0.4 });
    expect(r.confidence).toBe(0.9);
  });

  it("clamps out-of-range coordinates to 0..1", async () => {
    llmReturns({ x: -0.2, y: 1.4, w: 0.5, h: 0.5, confidence: 2 });
    const r = await locateFabricRegion("http://example.com/garment.jpg");
    expect(r.bbox.x).toBe(0);
    expect(r.bbox.y).toBe(1);
    expect(r.confidence).toBe(1);
  });

  it("falls back to a center crop on a zero-area box", async () => {
    llmReturns({ x: 0.1, y: 0.1, w: 0, h: 0.5, confidence: 0.8 });
    const r = await locateFabricRegion("http://example.com/garment.jpg");
    expect(r.bbox).toEqual({ x: 0.3, y: 0.3, w: 0.4, h: 0.4 });
    expect(r.confidence).toBe(0);
  });

  it("falls back to a center crop when the LLM output is unparseable", async () => {
    mockLLM.mockResolvedValue({ choices: [{ message: { content: "not json" } }] });
    const r = await locateFabricRegion("http://example.com/garment.jpg");
    expect(r.bbox).toEqual({ x: 0.3, y: 0.3, w: 0.4, h: 0.4 });
  });
});

describe("classical provider", () => {
  beforeEach(() => mockLLM.mockReset());

  it("returns a bbox-only fabric mask (no raster until S3)", async () => {
    llmReturns({ x: 0.2, y: 0.2, w: 0.6, h: 0.6, confidence: 0.7 });
    const mask = await getMaskProvider("classical").getFabricMask({
      url: "http://example.com/garment.jpg",
    });
    expect(mask.provider).toBe("classical");
    expect(mask.bbox.w).toBe(0.6);
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
  it("default Replicate client is unavailable until provisioned (no token)", async () => {
    await expect(
      defaultSam2Client().boxMask("data:image/png;base64,xx", [0, 0, 1, 1])
    ).rejects.toBeInstanceOf(MaskProviderUnavailableError);
  });
});
