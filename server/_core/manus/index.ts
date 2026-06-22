/**
 * Manus Agent API integration (api.manus.ai, v2). Server-only, ships DARK —
 * inert until MANUS_API_KEY is configured. See ./client.ts and ./types.ts.
 */
export {
  createManusClient,
  defaultManusClient,
  type ManusClient,
  type ManusClientOptions,
  type ManusRequestOptions,
} from "./client";
export {
  ManusApiError,
  ManusUnavailableError,
  type CreateTaskInput,
  type ListTasksInput,
  type ListTasksResult,
  type ManusEnvelope,
  type ManusErrorBody,
  type ManusErrorCode,
  type ManusMessageInput,
  type ManusTask,
} from "./types";
