/**
 * useGenerateStream — SSE streaming hook for density/scale generation.
 *
 * Instead of fire-and-forget + polling (which fails on serverless because the
 * container shuts down), this hook opens a streaming POST to the SSE endpoint
 * and keeps the connection alive with heartbeats until the job completes.
 *
 * The hook returns a `startStream` function that the caller invokes with the
 * generation parameters. It manages the stream lifecycle and calls the provided
 * callbacks on progress, completion, or error.
 */
import { useRef, useCallback } from "react";

export interface StreamCallbacks {
  onStarted: (data: { jobId: number; creditCost: number; newBalance: number }) => void;
  onHeartbeat: () => void;
  onProgress?: (data: { stage: string; percent: number }) => void;
  onDone: (data: {
    jobId: number;
    results: Array<{ url: string; key: string }>;
    creditsUsed: number;
    newBalance: number;
    lowBalance: boolean;
  }) => void;
  onError: (data: { jobId?: number; message: string; refunded?: boolean }) => void;
}

export interface StreamParams {
  tenantId: number;
  jobId: number;
  controls: unknown;
}

/**
 * Parse SSE events from a ReadableStream response body.
 * Each SSE event is `data: {...}\n\n` — we parse the JSON payload.
 */
async function consumeSSEStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  callbacks: StreamCallbacks,
  abortRef: { aborted: boolean }
) {
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    if (abortRef.aborted) break;

    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    // Process complete SSE events (delimited by \n\n)
    const events = buffer.split("\n\n");
    // Keep the last incomplete chunk in the buffer
    buffer = events.pop() || "";

    for (const event of events) {
      if (!event.trim()) continue;

      // Extract data from SSE format: "data: {...}"
      const dataMatch = event.match(/^data:\s*(.+)$/m);
      if (!dataMatch) continue;

      try {
        const parsed = JSON.parse(dataMatch[1]);

        switch (parsed.type) {
          case "started":
            callbacks.onStarted(parsed);
            break;
          case "heartbeat":
            callbacks.onHeartbeat();
            break;
          case "progress":
            callbacks.onProgress?.(parsed);
            break;
          case "done":
            callbacks.onDone(parsed);
            return; // Stream complete
          case "error":
            callbacks.onError(parsed);
            return; // Stream complete
          default:
            console.warn("[useGenerateStream] Unknown event type:", parsed.type);
        }
      } catch (e) {
        console.warn("[useGenerateStream] Failed to parse SSE event:", event, e);
      }
    }
  }

  // Process any remaining data in the buffer — the final event might not
  // have a trailing \n\n if the server closed the connection right after writing.
  if (buffer.trim()) {
    const dataMatch = buffer.match(/^data:\s*(.+)$/m);
    if (dataMatch) {
      try {
        const parsed = JSON.parse(dataMatch[1]);
        switch (parsed.type) {
          case "done":
            callbacks.onDone(parsed);
            return;
          case "error":
            callbacks.onError(parsed);
            return;
          case "started":
            callbacks.onStarted(parsed);
            break;
          case "heartbeat":
            callbacks.onHeartbeat();
            break;
        }
      } catch {
        // Incomplete JSON — fall through to error below
      }
    }
  }

  // The loop exits here only when the reader closes WITHOUT a terminal
  // `done`/`error` event (server crash, container kill, half-open response) and
  // the caller did not intentionally abort. Surface an error so the UI does not
  // hang in the "processing" state forever.
  if (!abortRef.aborted) {
    callbacks.onError({ message: "Connection closed before the job finished. Please try again." });
  }
}

export function useGenerateStream(callbacks: StreamCallbacks) {
  const abortControllerRef = useRef<AbortController | null>(null);
  const abortRef = useRef({ aborted: false });

  const startStream = useCallback(
    async (params: StreamParams) => {
      // Abort any existing stream
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      const controller = new AbortController();
      abortControllerRef.current = controller;
      abortRef.current = { aborted: false };

      try {
        const response = await fetch("/api/studio/generate-stream", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(params),
          signal: controller.signal,
        });

        // If the response is not SSE (e.g. a JSON error), handle it
        const contentType = response.headers.get("content-type") || "";
        if (!contentType.includes("text/event-stream")) {
          // It's a JSON error response
          const errorBody = await response.json().catch(() => ({ error: "Unknown error" }));
          callbacks.onError({ message: errorBody.error || `HTTP ${response.status}` });
          return;
        }

        if (!response.body) {
          callbacks.onError({ message: "No response body — streaming not supported" });
          return;
        }

        const reader = response.body.getReader();
        await consumeSSEStream(reader, callbacks, abortRef.current);
      } catch (err: any) {
        if (err.name === "AbortError") return; // Intentional abort
        callbacks.onError({ message: err.message || "Stream connection failed" });
      }
    },
    [callbacks]
  );

  const abort = useCallback(() => {
    abortRef.current.aborted = true;
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
  }, []);

  return { startStream, abort };
}
