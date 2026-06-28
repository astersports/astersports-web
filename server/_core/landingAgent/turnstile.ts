/**
 * Cloudflare Turnstile verification for the landing agent's bot gate
 * (docs/SPEC_LANDING_AGENT.txt P5, Fork D). Verifies the client's challenge
 * token server-side before a session's first model turn.
 *
 * FAIL CLOSED everywhere: an unset secret, a missing/empty token, a non-OK
 * response, a network error, or a non-success verdict all return false — so a
 * mis-config can never open the gate. The route therefore requires a VERIFIED
 * session before it will call the model.
 */
import { ENV } from "../env";

const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export interface TurnstileResult {
  success: boolean;
}

/** Defensively read Cloudflare's siteverify JSON — only an explicit `success:true` passes. */
export function parseTurnstileResult(json: unknown): TurnstileResult {
  const ok =
    !!json && typeof json === "object" && (json as { success?: unknown }).success === true;
  return { success: ok };
}

/** Whether the Turnstile gate is configured (secret present). */
export function isTurnstileConfigured(): boolean {
  return ENV.turnstileSecretKey.length > 0;
}

/**
 * Verify a Turnstile token with Cloudflare. Returns true ONLY on an explicit
 * success verdict; every failure path (no secret, no token, network/parse error,
 * non-success) returns false.
 */
export async function verifyTurnstile(
  token: string | undefined,
  ip: string | undefined,
): Promise<boolean> {
  if (!ENV.turnstileSecretKey) return false; // required-when-live → no secret denies
  if (!token || typeof token !== "string") return false;
  try {
    const body = new URLSearchParams({ secret: ENV.turnstileSecretKey, response: token });
    if (ip && ip !== "unknown") body.set("remoteip", ip);
    const res = await fetch(VERIFY_URL, { method: "POST", body });
    if (!res.ok) return false;
    return parseTurnstileResult(await res.json()).success;
  } catch {
    return false;
  }
}
