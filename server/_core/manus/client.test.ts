/**
 * Manus API client — transport, envelope unwrapping, error mapping, retry/backoff,
 * and the fail-safe-dark behaviour. Uses an injected fetch + sleep so no network
 * (or real key) is touched. A single live smoke test self-skips when MANUS_API_KEY
 * is absent, mirroring the repo's credential-gated test convention.
 */
import { describe, it, expect, vi } from "vitest";
import { createManusClient } from "./client";
import { ManusApiError, ManusUnavailableError } from "./types";

const KEY = "test-key-aaaaaaaaaaaa";

/** Build a JSON Response like the API would return. */
function jsonResponse(status: number, body: unknown, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...(headers ?? {}) },
  });
}

/** A fetch double that returns queued responses and records its calls. */
function fetchStub(responses: Response[]) {
  const calls: Array<{ url: string; init?: RequestInit; timeoutMs?: number }> = [];
  const fn = vi.fn(async (url: string, init?: RequestInit, timeoutMs?: number) => {
    calls.push({ url, init, timeoutMs });
    const next = responses.shift();
    if (!next) throw new Error("fetchStub: no more queued responses");
    return next;
  });
  return { fn, calls };
}

describe("createManusClient", () => {
  it("throws ManusUnavailableError (without fetching) when no key is configured", async () => {
    const { fn } = fetchStub([]);
    const client = createManusClient({ apiKey: "", fetchImpl: fn });
    await expect(client.createTask({ message: { content: "hi" } })).rejects.toBeInstanceOf(
      ManusUnavailableError
    );
    expect(fn).not.toHaveBeenCalled();
  });

  it("createTask sends key header + JSON body to task.create and unwraps the envelope", async () => {
    const { fn, calls } = fetchStub([
      jsonResponse(200, { ok: true, request_id: "req_1", task_id: "task_123", status: "queued" }),
    ]);
    const client = createManusClient({ apiKey: KEY, baseUrl: "https://api.manus.ai", fetchImpl: fn });

    const task = await client.createTask({ message: { content: "hello" } });

    expect(task).toMatchObject({ task_id: "task_123", status: "queued" });
    // Envelope keys are stripped from the returned payload.
    expect(task).not.toHaveProperty("ok");
    expect(task).not.toHaveProperty("request_id");

    const call = calls[0];
    expect(call.url).toBe("https://api.manus.ai/v2/task.create");
    expect(call.init?.method).toBe("POST");
    expect((call.init?.headers as Record<string, string>)["x-manus-api-key"]).toBe(KEY);
    expect(JSON.parse(call.init?.body as string)).toEqual({ message: { content: "hello" } });
  });

  it("listTasks issues a GET with serialized query params", async () => {
    const { fn, calls } = fetchStub([
      jsonResponse(200, { ok: true, request_id: "req_2", tasks: [], next_cursor: undefined }),
    ]);
    const client = createManusClient({ apiKey: KEY, baseUrl: "https://api.manus.ai", fetchImpl: fn });

    await client.listTasks({ limit: 10, cursor: "abc" });

    expect(calls[0].init?.method).toBe("GET");
    expect(calls[0].url).toBe("https://api.manus.ai/v2/task.list?limit=10&cursor=abc");
    expect(calls[0].init?.body).toBeUndefined();
  });

  it("maps an ok:false envelope to ManusApiError with code + request_id", async () => {
    const { fn } = fetchStub([
      jsonResponse(400, {
        ok: false,
        request_id: "req_3",
        error: { code: "invalid_argument", message: "task_id is required" },
      }),
    ]);
    const client = createManusClient({ apiKey: KEY, fetchImpl: fn });

    await expect(client.createTask({ message: { content: "x" } })).rejects.toMatchObject({
      name: "ManusApiError",
      code: "invalid_argument",
      status: 400,
      requestId: "req_3",
      message: "task_id is required",
    });
  });

  it("retries on 429 (rate_limited) then succeeds, backing off via injected sleep", async () => {
    const sleep = vi.fn(async () => {});
    const { fn } = fetchStub([
      jsonResponse(429, { ok: false, request_id: "r", error: { code: "rate_limited", message: "slow down" } }),
      jsonResponse(200, { ok: true, request_id: "r2", task_id: "task_ok" }),
    ]);
    const client = createManusClient({ apiKey: KEY, fetchImpl: fn, sleep });

    const task = await client.createTask({ message: { content: "x" } });
    expect(task).toMatchObject({ task_id: "task_ok" });
    expect(fn).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it("does NOT retry a non-transient 4xx", async () => {
    const sleep = vi.fn(async () => {});
    const { fn } = fetchStub([
      jsonResponse(403, { ok: false, request_id: "r", error: { code: "permission_denied", message: "nope" } }),
    ]);
    const client = createManusClient({ apiKey: KEY, fetchImpl: fn, sleep });

    await expect(client.request("/v2/task.list")).rejects.toBeInstanceOf(ManusApiError);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("gives up after maxRetries on persistent 5xx", async () => {
    const sleep = vi.fn(async () => {});
    const { fn } = fetchStub([
      jsonResponse(503, { ok: false, request_id: "a", error: { code: "unavailable", message: "down" } }),
      jsonResponse(503, { ok: false, request_id: "b", error: { code: "unavailable", message: "down" } }),
    ]);
    const client = createManusClient({ apiKey: KEY, fetchImpl: fn, sleep, maxRetries: 1 });

    await expect(client.request("/v2/task.list")).rejects.toMatchObject({ status: 503 });
    expect(fn).toHaveBeenCalledTimes(2); // initial + 1 retry
  });

  it("never leaks the API key in a thrown error message", async () => {
    const { fn } = fetchStub([
      jsonResponse(401, { ok: false, request_id: "r", error: { code: "permission_denied", message: "Invalid or missing API key" } }),
    ]);
    const client = createManusClient({ apiKey: KEY, fetchImpl: fn });
    const err = await client.createTask({ message: { content: "x" } }).catch((e) => e as Error);
    expect(err.message).not.toContain(KEY);
  });
});

// Live smoke test — self-skips in clean CI (no key), per the repo convention.
describe("Manus API (live)", () => {
  it.skipIf(!process.env.MANUS_API_KEY)("lists tasks against the real API", async () => {
    const client = createManusClient();
    const res = await client.listTasks({ limit: 1 });
    expect(res).toHaveProperty("tasks");
  });
});
