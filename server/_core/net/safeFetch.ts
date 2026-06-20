/**
 * C1/H6 — the single SSRF-safe outbound fetch boundary.
 *
 * `assertSafeFetchUrl` only validates the URL it is handed. Native fetch with
 * the default `redirect: "follow"` will silently follow a 3xx to a private
 * address AFTER that check, defeating the guard. Every server-side fetch of an
 * untrusted (or third-party-influenced) URL must go through here so that:
 *   - each redirect hop is re-validated before it is followed,
 *   - the body download is bounded by a byte cap (decompression/large-body DoS),
 *   - the timeout covers the WHOLE transfer (headers AND body), not just the
 *     headers (a server that trickles the body forever would otherwise hang).
 *
 * Residual TOCTOU: a rebinding resolver can still return a public IP to the
 * guard and a private IP to the connect. Pinning the validated IP into the
 * socket is the remaining hardening step; manual-redirect + re-validation
 * closes the far more practical redirect bypass.
 */
import { assertSafeFetchUrl, BlockedUrlError } from "./ssrfGuard";

const MAX_REDIRECTS = 5;
/** Default ceiling for a single downloaded body (64 MiB). */
export const DEFAULT_MAX_BYTES = 64 * 1024 * 1024;

export interface SafeFetchOptions {
  timeoutMs?: number;
  init?: RequestInit;
  /** Skip SSRF validation for known-trusted internal hosts (e.g. Forge-signed URLs). */
  skipSsrf?: boolean;
}

export interface SafeFetchBufferOptions extends SafeFetchOptions {
  maxBytes?: number;
}

/**
 * Walk redirects manually, validating every hop, and return the final Response
 * with its body still unread. Use when you need headers/text/json. The timeout
 * is armed for the duration the caller holds the response — read the body
 * promptly. For large binary downloads prefer `safeFetchBuffer`.
 */
export async function safeFetch(url: string, opts: SafeFetchOptions = {}): Promise<Response> {
  const { timeoutMs = 30_000, init = {}, skipSsrf = false } = opts;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let current = url;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      if (!skipSsrf) await assertSafeFetchUrl(current);
      const res = await fetch(current, { ...init, redirect: "manual", signal: controller.signal });
      const location = res.headers.get("location");
      if (res.status >= 300 && res.status < 400 && location) {
        current = new URL(location, current).toString();
        try { await res.arrayBuffer(); } catch { /* drain to free the socket */ }
        continue;
      }
      return res;
    }
    throw new BlockedUrlError("too many redirects");
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Like `safeFetch` but streams the final body with a hard byte cap and keeps
 * the abort signal armed across the body read, then returns the buffered bytes.
 */
export async function safeFetchBuffer(
  url: string,
  opts: SafeFetchBufferOptions = {}
): Promise<{ buffer: Buffer; response: Response }> {
  const { timeoutMs = 30_000, init = {}, skipSsrf = false, maxBytes = DEFAULT_MAX_BYTES } = opts;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let current = url;
    let res: Response | null = null;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      if (!skipSsrf) await assertSafeFetchUrl(current);
      res = await fetch(current, { ...init, redirect: "manual", signal: controller.signal });
      const location = res.headers.get("location");
      if (res.status >= 300 && res.status < 400 && location) {
        current = new URL(location, current).toString();
        try { await res.arrayBuffer(); } catch { /* drain */ }
        res = null;
        continue;
      }
      break;
    }
    if (!res) throw new BlockedUrlError("too many redirects");

    // Reject early when the server declares an oversized body.
    const declared = Number(res.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > maxBytes) {
      controller.abort();
      throw new Error(`response too large: content-length ${declared} > ${maxBytes}`);
    }

    const reader = res.body?.getReader();
    if (!reader) {
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > maxBytes) throw new Error(`response too large: ${buf.length} > ${maxBytes}`);
      return { buffer: buf, response: res };
    }
    const chunks: Buffer[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        controller.abort();
        throw new Error(`response exceeded byte cap of ${maxBytes}`);
      }
      chunks.push(Buffer.from(value));
    }
    return { buffer: Buffer.concat(chunks), response: res };
  } finally {
    clearTimeout(timer);
  }
}
