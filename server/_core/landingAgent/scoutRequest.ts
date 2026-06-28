/**
 * Pure request-layer helpers for the landing "Aster Scout" SSE endpoint
 * (docs/SPEC_LANDING_AGENT.txt, P3b). Kept separate from the Express/stream glue
 * so the parsing, IP extraction, and token estimation are unit-testable.
 */

export const MAX_MESSAGES = 16; // hard cap on transcript length the server accepts
export const MAX_CONTENT_LEN = 2000; // per-message char cap
export const MAX_SESSION_ID_LEN = 100;
export const MAX_OUTPUT_TOKENS = 512; // the model's max_tokens for a turn (small, by design)
export const MAX_TURNSTILE_TOKEN_LEN = 2048; // Cloudflare tokens are ~<1KB; cap defensively

export interface ScoutMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ScoutRequest {
  sessionId: string;
  messages: ScoutMessage[];
  /** Cloudflare Turnstile token for the bot gate (P5). Absent on verified-session turns. */
  turnstileToken?: string;
}

/**
 * Validate + clamp the incoming body. Throws on anything structurally wrong so
 * the route can answer 400 before any model call. Trims/caps content, drops
 * non-{user,assistant} roles, and requires at least one user message.
 */
export function parseScoutRequest(body: unknown): ScoutRequest {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;

  const sessionId = typeof b.sessionId === "string" ? b.sessionId.trim() : "";
  if (!sessionId || sessionId.length > MAX_SESSION_ID_LEN) {
    throw new Error("invalid sessionId");
  }

  if (!Array.isArray(b.messages) || b.messages.length === 0) {
    throw new Error("messages required");
  }
  if (b.messages.length > MAX_MESSAGES) {
    throw new Error("too many messages");
  }

  const messages: ScoutMessage[] = [];
  for (const raw of b.messages) {
    const m = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const role = m.role === "assistant" ? "assistant" : m.role === "user" ? "user" : null;
    const content = (typeof m.content === "string" ? m.content : "").trim();
    if (!role || content.length === 0) continue;
    messages.push({ role, content: content.slice(0, MAX_CONTENT_LEN) });
  }

  if (messages.length === 0 || !messages.some((m) => m.role === "user")) {
    throw new Error("at least one user message required");
  }

  // Optional Turnstile token: clamp length and reject non-strings silently (an
  // absent/garbage token simply fails the gate downstream — fail closed there).
  const rawToken = typeof b.turnstileToken === "string" ? b.turnstileToken.trim() : "";
  const turnstileToken = rawToken ? rawToken.slice(0, MAX_TURNSTILE_TOKEN_LEN) : undefined;

  return { sessionId, messages, turnstileToken };
}

/** Max textual length of an IPv6 address — anything longer is malicious. */
const IP_MAX = 45;

/**
 * Clamp + sanitize a candidate IP token before it becomes a limiter/ledger key.
 * An attacker-supplied X-Forwarded-For can be arbitrarily long or hold control
 * chars; restrict to the IP charset and cap the length so a malicious header
 * can't inflate memory or pollute logs. Never returns an empty string.
 */
function sanitizeIp(token: string): string {
  const cleaned = token.replace(/[^0-9a-fA-F:.]/g, "").slice(0, IP_MAX);
  return cleaned || "unknown";
}

/**
 * Best-effort client IP. Railway/most proxies set X-Forwarded-For (client is the
 * FIRST hop); fall back to x-real-ip then the socket address. Used as the
 * per-identity key for the spend + lead caps.
 *
 * NOTE (pre-flip, docs/SPEC_LANDING_AGENT.txt): X-Forwarded-For is
 * client-spoofable unless Express `trust proxy` is configured to the exact
 * number of proxy hops in front of the app. Before LANDING_AGENT_LIVE is
 * flipped, confirm the Railway hop count and set `trust proxy` so a forged XFF
 * can't evade the per-IP cap. The global fail-closed ceiling bounds total spend
 * regardless, and Turnstile (P5) gates the first model token — so the residual
 * pre-flip risk is bounded cardinality, which the clamp + sweep contain.
 */
export function clientIpFromHeaders(headers: Record<string, unknown>, socketAddr?: string): string {
  const xff = headers["x-forwarded-for"];
  const raw = Array.isArray(xff) ? xff[0] : typeof xff === "string" ? xff : "";
  const first = raw.split(",")[0]?.trim();
  if (first) return sanitizeIp(first);
  const real = headers["x-real-ip"];
  if (typeof real === "string" && real.trim()) return sanitizeIp(real.trim());
  return sanitizeIp((socketAddr || "unknown").trim());
}

/** ~4 chars/token heuristic; never an under-estimate the cap could be gamed by. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Estimate the tokens a turn will spend, for the spend guard's pre-check: the
 * system prompt + the whole transcript (input) + the max output. Generous on
 * purpose — settle reconciles to the real usage afterward.
 */
export function estimateTurnTokens(systemPrompt: string, messages: ScoutMessage[]): number {
  const input = estimateTokens(systemPrompt) + messages.reduce((n, m) => n + estimateTokens(m.content), 0);
  return input + MAX_OUTPUT_TOKENS;
}
