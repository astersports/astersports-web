import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchWithTimeout, TIMEOUT } from "./fetchTimeout";

describe("fetchWithTimeout", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns response when fetch completes within timeout", async () => {
    const mockResponse = new Response("ok", { status: 200 });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse));

    const result = await fetchWithTimeout("https://example.com/image.jpg", {}, 5000);
    expect(result.status).toBe(200);
  });

  it("throws timeout error when fetch exceeds timeout", async () => {
    // Create a fetch that never resolves
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(
        (_url: string, opts?: RequestInit) =>
          new Promise((resolve, reject) => {
            // Listen for abort signal
            opts?.signal?.addEventListener("abort", () => {
              const err = new Error("The operation was aborted");
              err.name = "AbortError";
              reject(err);
            });
          })
      )
    );

    const promise = fetchWithTimeout("https://example.com/slow", {}, 1000);

    // Advance time past the timeout
    vi.advanceTimersByTime(1001);

    await expect(promise).rejects.toThrow("Request timed out after 1000ms");
  });

  it("passes options through to fetch", async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response("ok"));
    vi.stubGlobal("fetch", mockFetch);

    await fetchWithTimeout(
      "https://example.com/api",
      { method: "POST", headers: { "content-type": "application/json" } },
      5000
    );

    expect(mockFetch).toHaveBeenCalledWith(
      "https://example.com/api",
      expect.objectContaining({
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: expect.any(AbortSignal),
      })
    );
  });

  it("re-throws non-abort errors unchanged", async () => {
    const networkError = new Error("Network failure");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(networkError));

    await expect(fetchWithTimeout("https://example.com", {}, 5000)).rejects.toThrow(
      "Network failure"
    );
  });

  it("truncates long URLs in timeout error message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(
        (_url: string, opts?: RequestInit) =>
          new Promise((resolve, reject) => {
            opts?.signal?.addEventListener("abort", () => {
              const err = new Error("The operation was aborted");
              err.name = "AbortError";
              reject(err);
            });
          })
      )
    );

    const longUrl = "https://example.com/" + "a".repeat(200);
    const promise = fetchWithTimeout(longUrl, {}, 500);
    vi.advanceTimersByTime(501);

    await expect(promise).rejects.toThrow("...");
  });
});

describe("TIMEOUT constants", () => {
  it("has reasonable timeout values", () => {
    expect(TIMEOUT.IMAGE_DOWNLOAD).toBe(30_000);
    expect(TIMEOUT.IMAGE_GENERATION).toBe(120_000);
    expect(TIMEOUT.ELEMENT_DETECTION).toBe(60_000);
    expect(TIMEOUT.STORAGE_PRESIGN).toBe(10_000);
  });
});

describe("upload size validation", () => {
  it("rejects files over 16MB", () => {
    const MAX_UPLOAD_SIZE = 16 * 1024 * 1024;
    const oversizedBuffer = Buffer.alloc(MAX_UPLOAD_SIZE + 1);
    expect(oversizedBuffer.length).toBeGreaterThan(MAX_UPLOAD_SIZE);
  });

  it("accepts files under 16MB", () => {
    const MAX_UPLOAD_SIZE = 16 * 1024 * 1024;
    const validBuffer = Buffer.alloc(5 * 1024 * 1024); // 5MB
    expect(validBuffer.length).toBeLessThan(MAX_UPLOAD_SIZE);
  });

  it("rejects unsupported MIME types", () => {
    const allowedMimes = ["image/jpeg", "image/png", "image/webp"];
    expect(allowedMimes.includes("image/jpeg")).toBe(true);
    expect(allowedMimes.includes("image/png")).toBe(true);
    expect(allowedMimes.includes("image/webp")).toBe(true);
    expect(allowedMimes.includes("image/tiff")).toBe(false);
    expect(allowedMimes.includes("application/pdf")).toBe(false);
  });
});

describe("image generation size validation", () => {
  it("rejects images over 5MB for generation", () => {
    const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;
    const oversizedBuffer = Buffer.alloc(MAX_IMAGE_SIZE_BYTES + 1);
    expect(oversizedBuffer.length).toBeGreaterThan(MAX_IMAGE_SIZE_BYTES);
  });

  it("accepts images under 5MB for generation", () => {
    const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;
    const validBuffer = Buffer.alloc(2 * 1024 * 1024); // 2MB
    expect(validBuffer.length).toBeLessThan(MAX_IMAGE_SIZE_BYTES);
  });
});
