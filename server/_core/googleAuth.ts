import { createRemoteJWKSet, jwtVerify } from "jose";
import { ENV } from "./env";

/**
 * Google OAuth 2.0 identity provider (replaces the Manus WebDev auth server).
 * Flow: /api/auth/google/login -> Google consent -> /api/oauth/callback. We
 * exchange the code for an id_token and verify it against Google's published
 * keys; the app's session is still our own JWT (see sdk.ts). No client secret or
 * Google token ever reaches the browser.
 */

const GOOGLE_AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";

// Cached, auto-refreshing key set — jose fetches Google's rotating signing keys.
const GOOGLE_JWKS = createRemoteJWKSet(new URL(GOOGLE_JWKS_URL));

export function isGoogleConfigured(): boolean {
  return Boolean(ENV.googleClientId && ENV.googleClientSecret);
}

/** The authorize URL the browser is sent to. `state` is the CSRF token (also held
 *  in a cookie and re-checked at the callback). */
export function buildGoogleAuthUrl(redirectUri: string, state: string): string {
  const url = new URL(GOOGLE_AUTH_ENDPOINT);
  url.searchParams.set("client_id", ENV.googleClientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", state);
  url.searchParams.set("access_type", "online"); // no refresh token — we use the id_token once
  url.searchParams.set("prompt", "select_account");
  return url.toString();
}

/** Exchange the authorization code for tokens; return the raw id_token (a JWT). */
export async function exchangeGoogleCode(code: string, redirectUri: string): Promise<string> {
  const resp = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: ENV.googleClientId,
      client_secret: ENV.googleClientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });

  if (!resp.ok) {
    // Body can echo client_id/redirect detail — log server-side, throw generic.
    const detail = await resp.text().catch(() => "");
    console.error(`[GoogleAuth] token exchange failed ${resp.status}: ${detail}`);
    throw new Error("Google token exchange failed");
  }

  const data = (await resp.json()) as { id_token?: string };
  if (!data.id_token) {
    throw new Error("Google token response missing id_token");
  }
  return data.id_token;
}

export type GoogleProfile = {
  /** Google's stable subject id — used as the openId namespace `google:<sub>`. */
  sub: string;
  email: string | null;
  name: string | null;
  emailVerified: boolean;
};

/** Verify the id_token signature + issuer + audience against Google's JWKS, then
 *  return the profile. Throws if verification fails (forged/expired/wrong audience). */
export async function verifyGoogleIdToken(idToken: string): Promise<GoogleProfile> {
  const { payload } = await jwtVerify(idToken, GOOGLE_JWKS, {
    issuer: ["https://accounts.google.com", "accounts.google.com"],
    audience: ENV.googleClientId,
  });

  const sub = typeof payload.sub === "string" ? payload.sub : "";
  if (!sub) throw new Error("Google id_token missing sub");

  return {
    sub,
    email: typeof payload.email === "string" ? payload.email : null,
    name: typeof payload.name === "string" ? payload.name : null,
    emailVerified: payload.email_verified === true,
  };
}

/** The app-internal stable user id derived from a Google subject. */
export function googleOpenId(sub: string): string {
  return `google:${sub}`;
}
