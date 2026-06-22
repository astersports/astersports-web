/**
 * Replicate webhook signature verification (ASYNC_GENERATION_SPEC §3). Replicate signs
 * outbound webhooks with the svix scheme (rebranded headers): `webhook-id`,
 * `webhook-timestamp`, `webhook-signature`. We verify HMAC-SHA256 over
 * `${id}.${timestamp}.${body}` with the base64-decoded REPLICATE_WEBHOOK_SECRET (the
 * `whsec_` prefix, if present, is stripped before decoding), constant-time compared against
 * each `v1,<sig>` entry in the (space-delimited, possibly multi-key) signature header.
 *
 * FAIL-CLOSED: returns false on a missing secret, missing/blank header, malformed or stale
 * timestamp (replay window), or any signature mismatch. The route MUST 401 and do NO work
 * before this passes — no body parse, no DB lookup, no decode.
 *
 * Node built-in `crypto` only (no svix dependency). Pure + deterministic given its inputs.
 */
import crypto from "node:crypto";

export interface ReplicateWebhookParts {
  /** `webhook-id` header. */
  id?: string | string[];
  /** `webhook-timestamp` header (unix seconds, as a string). */
  timestamp?: string | string[];
  /** `webhook-signature` header: space-delimited `v1,<base64sig>` entries. */
  signature?: string | string[];
  /** The RAW request body string — the exact bytes Replicate signed. Parse only AFTER verify. */
  body: string;
  /** REPLICATE_WEBHOOK_SECRET (svix base64, optional `whsec_` prefix). */
  secret: string;
  /** Replay tolerance in seconds (default 300). */
  toleranceSec?: number;
  /** Injectable clock (unix seconds) — for deterministic tests. */
  nowSec?: number;
}

/** Express lower-cases header keys and may deliver duplicates as an array; take the first. */
const first = (v?: string | string[]): string => (Array.isArray(v) ? (v[0] ?? "") : (v ?? ""));

/** Constant-time compare that never throws on a length mismatch. */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

export function verifyReplicateWebhook(parts: ReplicateWebhookParts): boolean {
  const secret = parts.secret ?? "";
  const id = first(parts.id);
  const timestamp = first(parts.timestamp);
  const signatureHeader = first(parts.signature);
  // Fail-closed on any missing input.
  if (!secret || !id || !timestamp || !signatureHeader) return false;

  // Replay window: reject a stale (or future-skewed) or malformed timestamp.
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;
  const now = parts.nowSec ?? Math.floor(Date.now() / 1000);
  const tol = parts.toleranceSec ?? 300;
  if (Math.abs(now - ts) > tol) return false;

  // Decode the svix secret (strip the `whsec_` prefix if present).
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  if (key.length === 0) return false;

  const expected = crypto
    .createHmac("sha256", key)
    .update(`${id}.${timestamp}.${parts.body ?? ""}`)
    .digest("base64");

  // The header is a space-delimited list of `v1,<sig>` (multiple during key rotation).
  // Accept if ANY entry matches (constant-time).
  return signatureHeader
    .split(" ")
    .map((entry) => (entry.includes(",") ? entry.slice(entry.indexOf(",") + 1) : entry))
    .filter((s) => s.length > 0)
    .some((sig) => safeEqual(sig, expected));
}

/** Compute the `v1,<sig>` header for a payload — mirrors what Replicate sends. Used by tests
 *  and (later) any self-test of the webhook path. */
export function signReplicateWebhook(id: string, timestamp: string | number, body: string, secret: string): string {
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const sig = crypto.createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest("base64");
  return `v1,${sig}`;
}
