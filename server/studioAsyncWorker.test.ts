/**
 * Phase 3 (ASYNC_GENERATION_SPEC §4 + §6) — processAsyncJob failure/refund matrix. The worker is
 * the §1 money-path guard for the async path: every degrade/no-op/failure must refund (idempotent,
 * `job-<id>-failed`) and mark `failed`; success saves the variation + marks `done` with NO refund;
 * concurrent webhook/cron ticks must not double-run the op (atomic claim). All deps mocked; the
 * Replicate client is injected. No network, no creds.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./_core/env", () => ({ ENV: { studioDensityRedistribute: false, studioWorkerDeadlineMs: 45000 } }));
vi.mock("./_core/masking/sam2Provider", () => ({ finishSam2Segmentation: vi.fn() }));
vi.mock("./_core/masking/replicateSam2", () => ({ defaultSam2Client: vi.fn(() => ({})) }));
vi.mock("./aiEngine", () => ({ runDensityOnSegmentation: vi.fn(), runScaleOnSegmentation: vi.fn() }));
vi.mock("./storage", () => ({ storagePut: vi.fn(), storageGetSignedUrl: vi.fn() }));
vi.mock("./studioDb", () => ({
  getJob: vi.fn(),
  addVariation: vi.fn(),
  grantCredits: vi.fn(),
  claimJobForCpuProcessing: vi.fn(),
  completeJobIfProcessing: vi.fn(),
  failJobIfClaimable: vi.fn(),
}));
vi.mock("./serverLog", () => ({ log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

import { processAsyncJob } from "./studioAsyncWorker";
import { finishSam2Segmentation } from "./_core/masking/sam2Provider";
import { runDensityOnSegmentation, runScaleOnSegmentation } from "./aiEngine";
import { storagePut } from "./storage";
import { getJob, addVariation, grantCredits, claimJobForCpuProcessing, completeJobIfProcessing, failJobIfClaimable } from "./studioDb";

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
  m(claimJobForCpuProcessing).mockResolvedValue(true);
  m(finishSam2Segmentation).mockResolvedValue({ fabric: { raster: {} }, instances: [{}] });
  m(storagePut).mockResolvedValue({ key: "k", url: "https://cdn/result.png" });
  m(addVariation).mockResolvedValue(undefined);
  m(completeJobIfProcessing).mockResolvedValue(true);
  m(failJobIfClaimable).mockResolvedValue(true);
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
    expect(completeJobIfProcessing).toHaveBeenCalledWith(7, 10);
    expect(grantCredits).not.toHaveBeenCalled();
  });

  it("succeeded + density no-op (removed 0 -> null) -> refund + failed", async () => {
    m(getJob).mockResolvedValue(densityJob);
    m(runDensityOnSegmentation).mockResolvedValue(null);
    const r = await processAsyncJob(7, client(SEG));
    expect(r.status).toBe("failed");
    expect(grantCredits).toHaveBeenCalledWith(3, 10, "refund", "job-7-failed", 9);
    expect(failJobIfClaimable).toHaveBeenCalledWith(7, expect.stringContaining("no-op"));
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

  it("op exceeds the worker deadline -> refund + failed, late result discarded (cancel-safe)", async () => {
    m(getJob).mockResolvedValue(densityJob);
    let resolveOp: (v: unknown) => void = () => {};
    m(runDensityOnSegmentation).mockReturnValue(new Promise((res) => { resolveOp = res; })); // stays pending past the deadline
    const r = await processAsyncJob(7, client(SEG), 20); // 20ms deadline -> deadline wins
    expect(r.status).toBe("failed");
    expect(failJobIfClaimable).toHaveBeenCalledWith(7, expect.stringContaining("deadline"));
    expect(grantCredits).toHaveBeenCalledWith(3, 10, "refund", "job-7-failed", 9);
    expect(addVariation).not.toHaveBeenCalled();
    // The late op completion must DISCARD, never deliver-and-refund: the finalize CAS now loses.
    m(completeJobIfProcessing).mockResolvedValue(false);
    resolveOp({ png: Buffer.from([1]), removed: 4 });
    await new Promise((res) => setTimeout(res, 20));
    expect(addVariation).not.toHaveBeenCalled();
    expect(grantCredits).toHaveBeenCalledTimes(1); // refunded exactly once
  });

  it("op finishes before the deadline -> done, billed, no refund", async () => {
    m(getJob).mockResolvedValue(densityJob);
    m(runDensityOnSegmentation).mockResolvedValue({ png: Buffer.from([1]), removed: 4 });
    const r = await processAsyncJob(7, client(SEG), 45000);
    expect(r.status).toBe("done");
    expect(completeJobIfProcessing).toHaveBeenCalledWith(7, 10);
    expect(grantCredits).not.toHaveBeenCalled();
  });

  it("fail/refund skipped when the job is already finalized (failJobIfClaimable loses) -> no double refund", async () => {
    m(getJob).mockResolvedValue(densityJob);
    m(runDensityOnSegmentation).mockResolvedValue(null); // no-op -> failAndRefund path
    m(failJobIfClaimable).mockResolvedValue(false); // a peer/deadline already finalized it
    const r = await processAsyncJob(7, client(SEG));
    expect(r.status).toBe("skipped");
    expect(grantCredits).not.toHaveBeenCalled();
  });
});
