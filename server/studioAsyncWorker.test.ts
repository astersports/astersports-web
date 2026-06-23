/**
 * Phase 3 (ASYNC_GENERATION_SPEC §4 + §6) — processAsyncJob failure/refund matrix. The worker is
 * the §1 money-path guard for the async path: every degrade/no-op/failure must refund (idempotent,
 * `job-<id>-failed`) and mark `failed`; success saves the variation + marks `done` with NO refund;
 * concurrent webhook/cron ticks must not double-run the op (atomic claim). All deps mocked; the
 * Replicate client is injected. No network, no creds.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./_core/env", () => ({ ENV: { studioDensityRedistribute: false } }));
vi.mock("./_core/masking/sam2Provider", () => ({ finishSam2Segmentation: vi.fn() }));
vi.mock("./_core/masking/replicateSam2", () => ({ defaultSam2Client: vi.fn(() => ({})) }));
vi.mock("./aiEngine", () => ({ runDensityOnSegmentation: vi.fn(), runScaleOnSegmentation: vi.fn() }));
vi.mock("./storage", () => ({ storagePut: vi.fn(), storageGetSignedUrl: vi.fn() }));
vi.mock("./studioDb", () => ({
  getJob: vi.fn(),
  updateJobStatus: vi.fn(),
  addVariation: vi.fn(),
  grantCredits: vi.fn(),
  claimJobForCpuProcessing: vi.fn(),
  incrementPollAttempts: vi.fn(),
}));
vi.mock("./serverLog", () => ({ log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

import { processAsyncJob } from "./studioAsyncWorker";
import { finishSam2Segmentation } from "./_core/masking/sam2Provider";
import { runDensityOnSegmentation, runScaleOnSegmentation } from "./aiEngine";
import { storagePut } from "./storage";
import { getJob, updateJobStatus, addVariation, grantCredits, claimJobForCpuProcessing, incrementPollAttempts } from "./studioDb";

const m = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

const densityJob = {
  id: 7, tenantId: 3, userId: 9, status: "sam2_processing",
  predictionId: "pred_7",
  predictionMeta: { bbox: { x: 0, y: 0, w: 1, h: 1 }, width: 100, height: 100, cropWidth: 80, cropHeight: 80 },
  controls: JSON.stringify({ density: { enabled: true, percent: 40 }, scale: { enabled: false, percent: 0 }, variations: 1 }),
  creditsUsed: 10, originalUrl: "https://cdn/x.jpg",
};

const client = (processResult: unknown) => ({ processPrediction: vi.fn().mockResolvedValue(processResult) } as any);
const SEG = { status: "succeeded", segmentation: { combined: Buffer.alloc(0), individuals: [] } };

beforeEach(() => {
  vi.clearAllMocks();
  m(incrementPollAttempts).mockResolvedValue(1); // default: first attempt, well under cap
  m(claimJobForCpuProcessing).mockResolvedValue(true);
  m(finishSam2Segmentation).mockResolvedValue({ fabric: { raster: {} }, instances: [{}] });
  m(storagePut).mockResolvedValue({ key: "k", url: "https://cdn/result.png" });
  m(addVariation).mockResolvedValue(undefined);
  m(updateJobStatus).mockResolvedValue(undefined);
  m(grantCredits).mockResolvedValue(0);
});

describe("processAsyncJob (§6 failure/refund matrix)", () => {
  it("succeeded + density -> runs op, saves variation, marks done, NO refund", async () => {
    m(getJob).mockResolvedValue(densityJob);
    m(runDensityOnSegmentation).mockResolvedValue({ png: Buffer.from([1]), removed: 4 });
    const r = await processAsyncJob(7, client(SEG));
    expect(r.status).toBe("done");
    expect(runDensityOnSegmentation).toHaveBeenCalledWith("https://cdn/x.jpg", expect.anything(), expect.anything(), 40, false);
    expect(addVariation).toHaveBeenCalledTimes(1);
    expect(updateJobStatus).toHaveBeenCalledWith(7, "done", { creditsUsed: 10 });
    expect(grantCredits).not.toHaveBeenCalled();
  });

  it("succeeded + density no-op (removed 0 -> null) -> refund + failed", async () => {
    m(getJob).mockResolvedValue(densityJob);
    m(runDensityOnSegmentation).mockResolvedValue(null);
    const r = await processAsyncJob(7, client(SEG));
    expect(r.status).toBe("failed");
    expect(grantCredits).toHaveBeenCalledWith(3, 10, "refund", "job-7-failed", 9);
    expect(updateJobStatus).toHaveBeenCalledWith(7, "failed", expect.objectContaining({ errorMessage: expect.stringContaining("no-op") }));
    expect(addVariation).not.toHaveBeenCalled();
  });

  it("Fix 1: refunds the per-attempt deductRef key when predictionMeta carries it", async () => {
    m(getJob).mockResolvedValue({ ...densityJob, predictionMeta: { ...densityJob.predictionMeta, deductRef: "job-7-a2" } });
    m(runDensityOnSegmentation).mockResolvedValue(null);
    const r = await processAsyncJob(7, client(SEG));
    expect(r.status).toBe("failed");
    // refunds <deductRef>-failed (attempt-scoped), NOT the fixed job-7-failed that
    // would collide across regenerate attempts and strand attempt 2's credits.
    expect(grantCredits).toHaveBeenCalledWith(3, 10, "refund", "job-7-a2-failed", 9);
  });

  it("prediction failed -> refund + failed, no claim/op", async () => {
    m(getJob).mockResolvedValue(densityJob);
    const r = await processAsyncJob(7, client({ status: "failed", error: "OOM" }));
    expect(r.status).toBe("failed");
    expect(grantCredits).toHaveBeenCalledWith(3, 10, "refund", "job-7-failed", 9);
    expect(claimJobForCpuProcessing).not.toHaveBeenCalled();
    expect(runDensityOnSegmentation).not.toHaveBeenCalled();
  });

  it("prediction still processing -> pending, no refund, no op", async () => {
    m(getJob).mockResolvedValue(densityJob);
    const r = await processAsyncJob(7, client({ status: "processing" }));
    expect(r.status).toBe("pending");
    expect(grantCredits).not.toHaveBeenCalled();
    expect(claimJobForCpuProcessing).not.toHaveBeenCalled();
  });

  it("claim lost to another worker -> skipped, no duplicate op/variation/refund", async () => {
    m(getJob).mockResolvedValue(densityJob);
    m(claimJobForCpuProcessing).mockResolvedValue(false);
    const r = await processAsyncJob(7, client(SEG));
    expect(r.status).toBe("skipped");
    expect(runDensityOnSegmentation).not.toHaveBeenCalled();
    expect(addVariation).not.toHaveBeenCalled();
    expect(grantCredits).not.toHaveBeenCalled();
  });

  it("scale op throws (non-repeat / no-op) -> refund + failed", async () => {
    const scaleJob = { ...densityJob, controls: JSON.stringify({ density: { enabled: false, percent: 0 }, scale: { enabled: true, percent: 50 }, variations: 1 }) };
    m(getJob).mockResolvedValue(scaleJob);
    m(runScaleOnSegmentation).mockRejectedValue(new Error("NON_REPEAT_SCALE"));
    const r = await processAsyncJob(7, client(SEG));
    expect(r.status).toBe("failed");
    expect(grantCredits).toHaveBeenCalledWith(3, 10, "refund", "job-7-failed", 9);
  });

  it("already terminal (done) -> skipped, no work", async () => {
    m(getJob).mockResolvedValue({ ...densityJob, status: "done" });
    const r = await processAsyncJob(7, client(SEG));
    expect(r.status).toBe("skipped");
    expect(grantCredits).not.toHaveBeenCalled();
  });

  it("no predictionId/meta (not an async job) -> skipped", async () => {
    m(getJob).mockResolvedValue({ ...densityJob, predictionId: null, predictionMeta: null });
    const r = await processAsyncJob(7, client(SEG));
    expect(r.status).toBe("skipped");
  });

  it("job not found -> skipped", async () => {
    m(getJob).mockResolvedValue(undefined);
    const r = await processAsyncJob(99, client(SEG));
    expect(r.status).toBe("skipped");
  });

  // T1.3: Poison-pill max-attempt cap
  it("T1.3: poison-pill terminates at attempt 5 with refund", async () => {
    m(getJob).mockResolvedValue(densityJob);
    m(incrementPollAttempts).mockResolvedValue(5); // at the cap
    const r = await processAsyncJob(7, client(SEG));
    expect(r.status).toBe("failed");
    expect(r.reason).toContain("poison-pill");
    expect(grantCredits).toHaveBeenCalledWith(3, 10, "refund", "job-7-failed", 9);
    expect(updateJobStatus).toHaveBeenCalledWith(7, "failed", expect.objectContaining({ errorMessage: expect.stringContaining("Poison-pill") }));
    // The prediction was never polled (no processPrediction call)
    expect(claimJobForCpuProcessing).not.toHaveBeenCalled();
  });

  it("T1.3: attempt 4 (below cap) proceeds normally", async () => {
    m(getJob).mockResolvedValue(densityJob);
    m(incrementPollAttempts).mockResolvedValue(4); // below cap
    m(runDensityOnSegmentation).mockResolvedValue({ png: Buffer.from([1]), removed: 4 });
    const r = await processAsyncJob(7, client(SEG));
    expect(r.status).toBe("done");
  });

  // T1.4: Worker deadline cancel-safe
  it("T1.4: deadline exceeded -> refund + failed with deadline reason", async () => {
    m(getJob).mockResolvedValue(densityJob);
    // Simulate a prediction that hangs forever (never resolves)
    const hangingClient = {
      processPrediction: vi.fn(() => new Promise(() => {})), // never resolves
    } as any;
    // Use fake timers to trigger the 150s deadline instantly
    vi.useFakeTimers();
    const promise = processAsyncJob(7, hangingClient);
    // Advance past the 150s deadline
    await vi.advanceTimersByTimeAsync(151_000);
    const r = await promise;
    vi.useRealTimers();
    expect(r.status).toBe("failed");
    expect(r.reason).toContain("deadline");
    expect(grantCredits).toHaveBeenCalledWith(3, 10, "refund", "job-7-failed", 9);
    expect(updateJobStatus).toHaveBeenCalledWith(7, "failed", expect.objectContaining({ errorMessage: expect.stringContaining("deadline") }));
  });

  it("T1.4: fast job completes well before deadline", async () => {
    m(getJob).mockResolvedValue(densityJob);
    m(runDensityOnSegmentation).mockResolvedValue({ png: Buffer.from([1]), removed: 4 });
    const r = await processAsyncJob(7, client(SEG));
    expect(r.status).toBe("done");
    // No deadline refund
    expect(grantCredits).not.toHaveBeenCalled();
  });
});
