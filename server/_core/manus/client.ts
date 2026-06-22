/**
 * Manus Agent API client (api.manus.ai, v2).
 *
 * Server-only — the API key grants full account access, so it must never reach
 * the browser bundle. Patterned on `defaultSam2Client()`: a factory + a
 * `requireKey()` that throws {@link ManusUnavailableError} when unconfigured, so
 * the integration is fail-safe DARK until MANUS_API_KEY is set.
 *
 * Transport is the repo's `fetchWithTimeout` (the host is a fixed first-party
 * endpoint, not an untrusted/third-party URL, so the SSRF boundary that guards
 * image fetches does not apply here). Responses use the `{ ok, request_id, ... }`
 * envelope; `request()` unwraps it and throws {@link ManusApiError} on `ok:false`.
 *
 * Only the two endpoints documented verbatim (task.create, task.list) are typed
 * as named methods; the generic `request<T>()` reaches any other v2 path without
 * this client guessing undocumented route names.
 *
 * Config (env): MANUS_API_KEY (required to use; absent => disabled). Base URL
 * overridable via MANUS_API_BASE_URL (defaults to https://api.manus.ai).
 */
import { ENV } from "../env";
import { fetchWithTimeout } from "../../fetchTimeout";
import {
  ManusApiError,
  ManusUnavailableError,
  type CreateTaskInput,
  type ListTasksInput,
  type ListTasksResult,
  type ManusEnvelope,
  type ManusErrorCode,
  type ManusTask,
} from "./types";

/** Default per-request deadline. Agent task creation returns a handle quickly; the
 *  long-running work is polled/streamed separately, so 60s is ample. */
const DEFAULT_TIMEOUT_MS = 60_000;
/** Retries on transient failures (429 / rate_limited / 5xx). */
const DEFAULT_MAX_RETRIES = 2;
const RETRY_BASE_MS = 500;

type FetchImpl = (url: string, options?: RequestInit, timeoutMs?: number) => Promise<Response>;

export interface ManusRequestOptions {
  method?: "GET" | "POST";
  /** Query params (GET). Undefined/null entries are dropped. */
  query?: Record<string, unknown>;
  /** JSON body (POST). */
  body?: unknown;
  /** Per-call timeout override. */
  timeoutMs?: number;
}

export interface ManusClientOptions {
  apiKey?: string;
  baseUrl?: string;
  timeoutMs?: number;
  maxRetries?: number;
  /** Injectable for tests; defaults to the repo `fetchWithTimeout`. */
  fetchImpl?: FetchImpl;
  /** Injectable backoff sleep; defaults to a real timer. */
  sleep?: (ms: number) => Promise<void>;
}

export interface ManusClient {
  /** Low-level typed call to any v2 path (e.g. "/v2/project.create"). */
  request<T extends object = Record<string, unknown>>(
    path: string,
    options?: ManusRequestOptions
  ): Promise<T>;
  /** POST /v2/task.create — start a new agent task. */
  createTask(input: CreateTaskInput): Promise<ManusTask>;
  /** GET /v2/task.list — list tasks. */
  listTasks(input?: ListTasksInput): Promise<ListTasksResult>;
}

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Map an HTTP status to a fallback error code when the body has no `error.code`. */
function codeFromStatus(status: number): ManusErrorCode {
  if (status === 404) return "not_found";
  if (status === 401 || status === 403) return "permission_denied";
  if (status === 429) return "rate_limited";
  if (status === 400) return "invalid_argument";
  return `http_${status}`;
}

function buildUrl(baseUrl: string, path: string, query?: Record<string, unknown>): string {
  const url = new URL(path, baseUrl.endsWith("/") ? baseUrl : baseUrl + "/");
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

/**
 * Build a Manus client. Throws {@link ManusUnavailableError} on first use (not at
 * construction) when no API key is configured, so importing this module is always
 * safe even with the integration dark.
 */
export function createManusClient(opts: ManusClientOptions = {}): ManusClient {
  const apiKey = opts.apiKey ?? ENV.manusApiKey;
  const baseUrl = opts.baseUrl ?? ENV.manusApiBaseUrl;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
  const doFetch = opts.fetchImpl ?? (fetchWithTimeout as FetchImpl);
  const sleep = opts.sleep ?? realSleep;

  function requireKey(): string {
    if (!apiKey) {
      throw new ManusUnavailableError(
        "Manus API not provisioned: set MANUS_API_KEY to enable the integration."
      );
    }
    return apiKey;
  }

  async function request<T extends object = Record<string, unknown>>(
    path: string,
    options: ManusRequestOptions = {}
  ): Promise<T> {
    const key = requireKey();
    const method = options.method ?? (options.body !== undefined ? "POST" : "GET");
    const url = buildUrl(baseUrl, path.replace(/^\//, ""), options.query);

    const init: RequestInit = {
      method,
      headers: {
        "Content-Type": "application/json",
        // Full-access secret — header only, never logged or echoed.
        "x-manus-api-key": key,
      },
    };
    if (options.body !== undefined) init.body = JSON.stringify(options.body);

    let lastErr: ManusApiError | undefined;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const res = await doFetch(url, init, options.timeoutMs ?? timeoutMs);

      let json: ManusEnvelope<T> | undefined;
      try {
        json = (await res.json()) as ManusEnvelope<T>;
      } catch {
        json = undefined;
      }

      if (res.ok && json && json.ok === true) {
        // Strip the envelope keys; return the payload (callers type the rest).
        const { ok: _ok, request_id: _rid, ...payload } = json as Record<string, unknown> & {
          ok: true;
          request_id: string;
        };
        return payload as unknown as T;
      }

      const errBody = json && json.ok === false ? json.error : undefined;
      const code = errBody?.code ?? codeFromStatus(res.status);
      const message = errBody?.message ?? `Manus API request failed (${res.status})`;
      const requestId = json?.request_id;
      lastErr = new ManusApiError(code, message, res.status, requestId);

      // Retry only transient failures, and only if we have attempts left.
      const transient = res.status === 429 || res.status >= 500 || code === "rate_limited";
      if (!transient || attempt === maxRetries) throw lastErr;

      const retryAfter = Number(res.headers.get("retry-after"));
      const backoff = Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : RETRY_BASE_MS * 2 ** attempt;
      await sleep(backoff);
    }
    // Unreachable (loop either returns or throws), but satisfies the type checker.
    throw lastErr ?? new ManusApiError("unknown", "Manus API request failed", 0);
  }

  return {
    request,
    createTask: (input) => request<ManusTask>("/v2/task.create", { method: "POST", body: input }),
    listTasks: (input) =>
      request<ListTasksResult>("/v2/task.list", {
        method: "GET",
        query: input as Record<string, unknown> | undefined,
      }),
  };
}

/** Convenience default bound to the configured env. Inert until MANUS_API_KEY is set. */
export function defaultManusClient(): ManusClient {
  return createManusClient();
}
