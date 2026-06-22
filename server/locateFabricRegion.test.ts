/**
 * Phase 5 — locateFabricRegion bounded against the 60s platform cap. Verifies:
 *  - it fetches + downscales the source server-side and passes an inline data-URL to the vision
 *    LLM (so the provider never fetches the full multi-MB image — the latency that blew the cap);
 *  - on an LLM error it cleanly returns DEFAULT_REGION (no throw bubbles up to fail generation);
 *  - on a >20s timeout it returns DEFAULT_REGION.
 * LLM / SSRF-fetch / sharp / storage all mocked — no network, no creds.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockInvoke, mockFetch, mockSign } = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
  mockFetch: vi.fn(),
  mockSign: vi.fn(async (k: string) => `https://signed/${k}`),
}));

vi.mock("./_core/llm", () => ({ invokeLLM: mockInvoke }));
vi.mock("./_core/net/safeFetch", () => ({ safeFetchBuffer: mockFetch }));
vi.mock("./storage", () => ({ storageGetSignedUrl: mockSign }));
vi.mock("sharp", () => {
  const chain: any = {};
  chain.rotate = vi.fn(() => chain);
  chain.resize = vi.fn(() => chain);
  chain.jpeg = vi.fn(() => chain);
  chain.toBuffer = vi.fn(async () => Buffer.from([1, 2, 3]));
  return { default: vi.fn(() => chain) };
});

import { locateFabricRegion, locateFabricRegionForDensity } from "./_core/masking/locateFabricRegion";

const DEFAULT_REGION = { bbox: { x: 0.05, y: 0.05, w: 0.9, h: 0.9 }, confidence: 0 };

beforeEach(() => {
  vi.clearAllMocks();
  mockFetch.mockResolvedValue({ buffer: Buffer.from([0, 1, 2, 3]), response: { ok: true, status: 200 } });
});

describe("locateFabricRegion (Phase 5: downscale + timeout + fallback)", () => {
  it("downscales server-side and passes an inline data-URL (not the signed URL) to the vision LLM", async () => {
    mockInvoke.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({ x: 0.1, y: 0.1, w: 0.8, h: 0.8, confidence: 0.9 }) } }],
    });

    const result = await locateFabricRegion("https://cdn/garment.jpg");

    expect(mockFetch).toHaveBeenCalledTimes(1); // WE fetch (SSRF-guarded), not the provider
    const arg = mockInvoke.mock.calls[0][0];
    const imageContent = arg.messages[1].content.find((c: any) => c.type === "image_url");
    expect(imageContent.image_url.url).toMatch(/^data:image\/jpeg;base64,/);
    expect(imageContent.image_url.detail).toBe("low");
    expect(result.confidence).toBe(0.9);
    expect(result.bbox.w).toBeGreaterThan(0.8); // expanded, not the default
  });

  it("returns DEFAULT_REGION when the vision LLM throws (clean fallback, no bubble)", async () => {
    mockInvoke.mockRejectedValue(new Error("model error"));
    const result = await locateFabricRegion("https://cdn/garment.jpg");
    expect(result).toEqual(DEFAULT_REGION);
  });

  it("returns DEFAULT_REGION when the locate exceeds the 20s timeout", async () => {
    vi.useFakeTimers();
    try {
      mockInvoke.mockReturnValue(new Promise(() => {})); // never resolves
      const p = locateFabricRegionForDensity("https://cdn/garment.jpg");
      await vi.advanceTimersByTimeAsync(20_001);
      await expect(p).resolves.toEqual(DEFAULT_REGION);
    } finally {
      vi.useRealTimers();
    }
  });
});
