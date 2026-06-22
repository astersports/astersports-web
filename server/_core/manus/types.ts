/**
 * Manus Agent API (api.manus.ai) — v2 request/response types + error classes.
 *
 * Ships DARK. This is an inert client library: it is not wired into any router,
 * job, webhook, or money path, and nothing invokes it until a feature opts in.
 * Absent MANUS_API_KEY the client throws {@link ManusUnavailableError} (fail-safe),
 * so the integration stays off until Frank provisions the key. No `*_LIVE` flag,
 * no credit-path coupling.
 *
 * Docs: https://open.manus.ai/docs/v2/overview
 */

/** Canonical error codes returned by the API (kept open for forward-compat). */
export type ManusErrorCode =
  | "invalid_argument"
  | "not_found"
  | "permission_denied"
  | "rate_limited"
  | (string & {});

/** The `error` block on a failed envelope (`ok: false`). */
export interface ManusErrorBody {
  code: ManusErrorCode;
  message: string;
}

/**
 * Every API response is wrapped. Success spreads the payload alongside
 * `ok`/`request_id`; failure carries `error`. Modeled permissively because the
 * per-endpoint success payloads are not all documented verbatim.
 */
export type ManusEnvelope<T extends object = Record<string, unknown>> =
  | ({ ok: true; request_id: string } & T)
  | { ok: false; request_id: string; error: ManusErrorBody };

/** A single message in a task turn. */
export interface ManusMessageInput {
  content: string;
}

/** Body for `POST /v2/task.create`. Extra documented fields pass through. */
export interface CreateTaskInput {
  message: ManusMessageInput;
  /** Attach the task to a project (shared instructions apply). */
  project_id?: string;
  /** Attachment file ids from `files.upload`. */
  file_ids?: string[];
  /** Forward-compat passthrough for documented-but-unmodeled fields. */
  [key: string]: unknown;
}

/** A task resource. `task_id` is the stable identifier; other fields pass through. */
export interface ManusTask {
  task_id: string;
  status?: string;
  [key: string]: unknown;
}

/** Query for `GET /v2/task.list`. */
export interface ListTasksInput {
  limit?: number;
  cursor?: string;
}

/** Response shape for `GET /v2/task.list`. */
export interface ListTasksResult {
  tasks: ManusTask[];
  next_cursor?: string;
  [key: string]: unknown;
}

/**
 * Thrown when the API returns `ok: false` (or a non-2xx with no usable body).
 * Carries the API error `code`, the HTTP `status`, and the `request_id` for
 * support correlation. The message NEVER includes the API key.
 */
export class ManusApiError extends Error {
  readonly code: ManusErrorCode;
  readonly status: number;
  readonly requestId?: string;
  constructor(code: ManusErrorCode, message: string, status: number, requestId?: string) {
    super(message);
    this.name = "ManusApiError";
    this.code = code;
    this.status = status;
    this.requestId = requestId;
  }
}

/**
 * Thrown when the client is used without MANUS_API_KEY configured. Mirrors
 * MaskProviderUnavailableError: an unprovisioned integration fails safe and loud
 * instead of making a keyless call.
 */
export class ManusUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ManusUnavailableError";
  }
}
