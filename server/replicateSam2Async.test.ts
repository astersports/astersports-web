/**
 * Phase 2 (ASYNC_GENERATION_SPEC §2) — Sam2Client async seam. Verifies startPrediction
 * (predictions.create, returns id immediately, no long-poll) and processPrediction
 * (predictions.get → on succeeded download masks via the SSRF-guarded fetch → segmentation;
 * failed/canceled/aborted → {failed,error}; still-running → {processing} with NO download).
 * Fully mocked — the `replicate` SDK, the SSRF fetch, and ENV — so it runs in CI without
 * Replicate credentials or network. No behavior change to the existing sync autoSegment path.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockCreate, mockGet, mockSafeFetch } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockGet: vi.fn(),
  mockSafeFetch: vi.fn(),
}));

vi.mock("replicate", () => ({
  // `new Replicate(...)` returns this object (a constructor returning an object wins over `new`).
  default: vi.fn().mockImplementation(function () {
    return { predictions: { create: mockCreate, get: mockGet } };
  }),
}));
vi.mock("./_core/net/safeFetch", () => ({ safeFetchBuffer: mockSafeFetch }));
vi.mock("./_core/env", () => ({
  ENV: {
    replicateApiToken: "test-token",
    replicateSam2Model: "",
    studioSam2PointsPerSide: 16,
    studioSam2UseM2m: false,
  },
}));

import { defaultSam2Client, resolvePredictionTarget } from "./_core/masking/replicateSam2";
import { ENV } from "./_core/env";
import { MaskProviderUnavailableError } from "./_core/masking/types";

beforeEach(() => {
  vi.clearAllMocks();
  ENV.replicateApiToken = "test-token";
  // Default: SSRF-guarded download returns a small buffer with an ok response.
  mockSafeFetch.mockResolvedValue({ buffer: Buffer.from([1, 2, 3]), response: { ok: true, status: 200 } });
});

describe("resolvePredictionTarget", () => {
  const DEFAULT_VERSION = "fe97b453a6455861e3bac769b441ca1f1086110da7466dbb65cf1eecfd60dc83";
  it("always resolves to a { version } — SAM2 is a community model, so the slug path 404s", () => {
    // An explicit version (owner/model:version or :version) always wins.
    expect(resolvePredictionTarget("meta/sam-2:abc123")).toEqual({ version: "abc123" });
    expect(resolvePredictionTarget("zsxkib/segment-anything-2:abc123")).toEqual({ version: "abc123" });
    // A bare token is a version hash.
    expect(resolvePredictionTarget("deadbeefcafe")).toEqual({ version: "deadbeefcafe" });
    // Empty OR any version-less slug pins the confirmed default version (the bare slug 404s on
    // the official-model endpoint, so we never emit { model } for a community model here).
    expect(resolvePredictionTarget("")).toEqual({ version: DEFAULT_VERSION });
    expect(resolvePredictionTarget("meta/sam-2")).toEqual({ version: DEFAULT_VERSION });
    expect(resolvePredictionTarget("zsxkib/segment-anything-2")).toEqual({ version: DEFAULT_VERSION });
  });
});

describe("Sam2Client.startPrediction", () => {
  it("creates a prediction and returns its id immediately (no webhook by default)", async () => {
    mockCreate.mockResolvedValue({ id: "pred_1", status: "starting" });

    const id = await defaultSam2Client().startPrediction("data:image/png;base64,AAAA");

    expect(id).toBe("pred_1");
    expect(mockCreate).toHaveBeenCalledTimes(1);
    const arg = mockCreate.mock.calls[0][0];
    expect(arg).toMatchObject({
      // Empty REPLICATE_SAM2_MODEL -> the confirmed default version (NOT the bare slug, which 404s).
      version: "fe97b453a6455861e3bac769b441ca1f1086110da7466dbb65cf1eecfd60dc83",
      input: {
        image: "data:image/png;base64,AAAA",
        points_per_side: 16,
        pred_iou_thresh: 0.82,
        stability_score_thresh: 0.88,
        use_m2m: false,
      },
    });
    expect(arg).not.toHaveProperty("webhook");
  });

  it("wires the webhook + completed-only filter when a webhookUrl is passed", async () => {
    mockCreate.mockResolvedValue({ id: "pred_2", status: "starting" });

    await defaultSam2Client().startPrediction("data:img", { pointsPerSide: 32 }, "https://app.example/api/webhooks/replicate");

    const arg = mockCreate.mock.calls[0][0];
    expect(arg.webhook).toBe("https://app.example/api/webhooks/replicate");
    expect(arg.webhook_events_filter).toEqual(["completed"]);
    expect(arg.input.points_per_side).toBe(32); // option override flows through
  });

  it("throws MaskProviderUnavailableError when the token is missing", async () => {
    ENV.replicateApiToken = "";
    await expect(defaultSam2Client().startPrediction("data:img")).rejects.toBeInstanceOf(MaskProviderUnavailableError);
    expect(mockCreate).not.toHaveBeenCalled();
  });
});

describe("Sam2Client.processPrediction", () => {
  it("on succeeded, downloads masks (SSRF-guarded) and returns the segmentation", async () => {
    mockGet.mockResolvedValue({
      id: "pred_1",
      status: "succeeded",
      output: { combined_mask: "https://r/c.png", individual_masks: ["https://r/i1.png", "https://r/i2.png"] },
    });

    const result = await defaultSam2Client().processPrediction("pred_1");

    expect(result.status).toBe("succeeded");
    if (result.status !== "succeeded") throw new Error("unreachable");
    expect(result.segmentation.combined).toBeInstanceOf(Buffer);
    expect(result.segmentation.individuals).toHaveLength(2);
    expect(mockGet).toHaveBeenCalledWith("pred_1");
    expect(mockSafeFetch).toHaveBeenCalledTimes(3); // combined + 2 individuals
  });

  it("on failed, returns { failed, error } and does NOT download", async () => {
    mockGet.mockResolvedValue({ id: "p", status: "failed", error: "OOM in segmenter" });

    const result = await defaultSam2Client().processPrediction("p");

    expect(result).toEqual({ status: "failed", error: "OOM in segmenter" });
    expect(mockSafeFetch).not.toHaveBeenCalled();
  });

  it("on canceled/aborted, returns { failed, ... } (worker refunds either way)", async () => {
    mockGet.mockResolvedValue({ id: "p", status: "canceled", error: null });
    const result = await defaultSam2Client().processPrediction("p");
    expect(result.status).toBe("failed");
    if (result.status !== "failed") throw new Error("unreachable");
    expect(result.error).toContain("canceled");
  });

  it("on still-running, returns { processing } with no download", async () => {
    mockGet.mockResolvedValue({ id: "p", status: "processing" });
    const result = await defaultSam2Client().processPrediction("p");
    expect(result).toEqual({ status: "processing" });
    expect(mockSafeFetch).not.toHaveBeenCalled();
  });
});
