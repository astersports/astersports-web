/**
 * Phase 4 (ASYNC_GENERATION_SPEC §4) — the enqueue seam. Verifies startSam2Segmentation does the
 * synchronous-at-enqueue work (locate + crop) then STARTS the prediction WITHOUT waiting on it:
 * it calls the Sam2Client's startPrediction (predictions.create, returns immediately) and NEVER
 * autoSegment (the blocking long-poll). Returns the predictionId + crop geometry (PredictionMeta)
 * for the worker to finish later. Crop-to-fabric minimization preserved (only a cropped data-URL
 * is sent). locate/decode/sharp mocked; the Replicate client is injected. No network, no creds.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockLocateDensity, mockLocate, mockDecode } = vi.hoisted(() => ({
  mockLocateDensity: vi.fn(),
  mockLocate: vi.fn(),
  mockDecode: vi.fn(),
}));

vi.mock("./_core/masking/locateFabricRegion", () => ({
  locateFabricRegion: mockLocate,
  locateFabricRegionForDensity: mockLocateDensity,
}));
vi.mock("./_core/image/decodeUpright", () => ({ decodeUpright: mockDecode }));
vi.mock("sharp", () => {
  const chain: any = {};
  chain.extract = vi.fn(() => chain);
  chain.png = vi.fn(() => chain);
  chain.toBuffer = vi.fn(async () => Buffer.from([9, 9, 9]));
  return { default: vi.fn(() => chain) };
});

import { startSam2Segmentation } from "./_core/masking/sam2Provider";

const mockStartPrediction = vi.fn();
const mockAutoSegment = vi.fn();
const client = () =>
  ({
    autoSegment: mockAutoSegment,
    startPrediction: mockStartPrediction,
    processPrediction: vi.fn(),
    boxMask: vi.fn(),
  } as any);

beforeEach(() => {
  vi.clearAllMocks();
  mockLocateDensity.mockResolvedValue({ bbox: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 }, confidence: 0.9 });
  mockDecode.mockResolvedValue({ buffer: Buffer.alloc(100 * 100 * 4), width: 100, height: 100 });
  mockStartPrediction.mockResolvedValue("pred_async_1");
});

describe("startSam2Segmentation (enqueue seam — fast, non-blocking)", () => {
  it("locates + crops, STARTS the prediction (no autoSegment wait), returns predictionId + meta", async () => {
    const out = await startSam2Segmentation({ url: "https://cdn/g.jpg" }, { client: client(), forDensity: true });

    expect(out.predictionId).toBe("pred_async_1");
    expect(out.meta).toMatchObject({ width: 100, height: 100, bbox: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 } });
    expect(out.meta.cropWidth).toBe(80); // round(0.8 * 100), clamped within bounds
    expect(out.meta.cropHeight).toBe(80);

    expect(mockStartPrediction).toHaveBeenCalledTimes(1);
    expect(mockAutoSegment).not.toHaveBeenCalled(); // crucial: does NOT block on the prediction
    expect(mockLocateDensity).toHaveBeenCalledWith("https://cdn/g.jpg"); // density locator (forDensity)
    // Crop-to-fabric minimization: only a cropped data-URL is sent to Replicate.
    expect(mockStartPrediction.mock.calls[0][0]).toMatch(/^data:image\/png;base64,/);
  });

  it("threads a webhookUrl through to startPrediction", async () => {
    await startSam2Segmentation(
      { url: "https://cdn/g.jpg" },
      { client: client(), webhookUrl: "https://app.example/api/webhooks/replicate" }
    );
    expect(mockStartPrediction).toHaveBeenCalledWith(
      expect.stringContaining("data:image/png;base64,"),
      undefined,
      "https://app.example/api/webhooks/replicate"
    );
  });
});
