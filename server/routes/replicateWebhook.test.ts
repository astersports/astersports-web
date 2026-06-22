/**
 * Phase 3 (ASYNC_GENERATION_SPEC §3) — /api/webhooks/replicate handler. Confirms it is
 * fail-closed (401 before any work on a bad/missing signature), stays dark when STUDIO_ASYNC_JOBS
 * is off (202, no dispatch), and on a verified event dispatches the job to the async worker. Uses
 * the REAL verifier + signer (so the fail-closed path is genuinely exercised); DB + worker mocked.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../_core/env", () => ({
  ENV: { replicateWebhookSecret: "whsec_" + Buffer.from("test-secret-bytes").toString("base64"), studioAsyncJobs: true },
}));
vi.mock("../studioDb", () => ({ getJobByPredictionId: vi.fn() }));
vi.mock("../studioAsyncWorker", () => ({ processAsyncJob: vi.fn() }));
vi.mock("../serverLog", () => ({ log: { error: vi.fn() } }));

import { handleReplicateWebhook } from "./replicateWebhook";
import { signReplicateWebhook } from "../_core/net/replicateWebhookVerify";
import { ENV } from "../_core/env";
import { getJobByPredictionId } from "../studioDb";
import { processAsyncJob } from "../studioAsyncWorker";

const m = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

function res() {
  const r: any = { statusCode: 0, body: null };
  r.status = vi.fn((c: number) => { r.statusCode = c; return r; });
  r.json = vi.fn((b: any) => { r.body = b; return r; });
  return r;
}
function reqWith(bodyStr: string, sign: boolean) {
  const id = "msg_1";
  const ts = String(Math.floor(Date.now() / 1000));
  const headers: Record<string, string> = {};
  if (sign) {
    headers["webhook-id"] = id;
    headers["webhook-timestamp"] = ts;
    headers["webhook-signature"] = signReplicateWebhook(id, ts, bodyStr, ENV.replicateWebhookSecret);
  }
  return { headers, body: Buffer.from(bodyStr) } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  (ENV as any).studioAsyncJobs = true;
});

describe("handleReplicateWebhook (fail-closed)", () => {
  it("401 on a bad/missing signature, BEFORE any DB work", async () => {
    const r = res();
    await handleReplicateWebhook(reqWith(JSON.stringify({ id: "pred_1" }), false), r);
    expect(r.statusCode).toBe(401);
    expect(getJobByPredictionId).not.toHaveBeenCalled();
    expect(processAsyncJob).not.toHaveBeenCalled();
  });

  it("verified + async on + job found -> dispatches processAsyncJob", async () => {
    m(getJobByPredictionId).mockResolvedValue({ id: 7 });
    m(processAsyncJob).mockResolvedValue({ status: "done" });
    const r = res();
    await handleReplicateWebhook(reqWith(JSON.stringify({ id: "pred_7" }), true), r);
    expect(r.statusCode).toBe(200);
    expect(getJobByPredictionId).toHaveBeenCalledWith("pred_7");
    expect(processAsyncJob).toHaveBeenCalledWith(7);
  });

  it("verified but STUDIO_ASYNC_JOBS off -> 202, no dispatch (dark)", async () => {
    (ENV as any).studioAsyncJobs = false;
    const r = res();
    await handleReplicateWebhook(reqWith(JSON.stringify({ id: "pred_7" }), true), r);
    expect(r.statusCode).toBe(202);
    expect(processAsyncJob).not.toHaveBeenCalled();
  });

  it("verified, async on, no job for that prediction -> 202, no dispatch", async () => {
    m(getJobByPredictionId).mockResolvedValue(undefined);
    const r = res();
    await handleReplicateWebhook(reqWith(JSON.stringify({ id: "pred_x" }), true), r);
    expect(r.statusCode).toBe(202);
    expect(processAsyncJob).not.toHaveBeenCalled();
  });
});
