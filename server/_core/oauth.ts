import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import { parse as parseCookieHeader } from "cookie";
import type { Express, Request, Response } from "express";
import * as db from "../db";
import { getSessionCookieOptions, isSecureRequest } from "./cookies";
import { ENV } from "./env";
import {
  buildGoogleAuthUrl,
  exchangeGoogleCode,
  googleOpenId,
  isGoogleConfigured,
  verifyGoogleIdToken,
} from "./googleAuth";
import { sdk } from "./sdk";

/** CSRF state cookie for the Google round-trip. SameSite=Lax (from
 *  getSessionCookieOptions) lets it ride the top-level redirect back from Google. */
const OAUTH_STATE_COOKIE = "oauth_state";
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes

function getQueryParam(req: Request, key: string): string | undefined {
  const value = req.query[key];
  return typeof value === "string" ? value : undefined;
}

/** The app's external origin, used to build the redirect_uri that must match the
 *  one registered in Google. Forces https off localhost (Google requires it). */
function externalOrigin(req: Request): string {
  const secure = ENV.isProduction || isSecureRequest(req);
  const host = req.get("host") ?? "";
  return `${secure ? "https" : "http"}://${host}`;
}

function callbackUri(req: Request): string {
  return `${externalOrigin(req)}/api/oauth/callback`;
}

export function registerOAuthRoutes(app: Express) {
  // Step 1: send the browser to Google with a fresh CSRF state (also stored in a
  // short-lived cookie and re-checked at the callback).
  app.get("/api/auth/google/login", (req: Request, res: Response) => {
    if (!isGoogleConfigured()) {
      res.status(503).json({ error: "Google sign-in is not configured" });
      return;
    }
    const state = crypto.randomUUID();
    res.cookie(OAUTH_STATE_COOKIE, state, {
      ...getSessionCookieOptions(req),
      maxAge: OAUTH_STATE_TTL_MS,
    });
    res.redirect(302, buildGoogleAuthUrl(callbackUri(req), state));
  });

  // Step 2: Google redirects here with ?code&state. Verify state (CSRF), exchange
  // the code, verify the id_token, then mint OUR session cookie.
  app.get("/api/oauth/callback", async (req: Request, res: Response) => {
    const code = getQueryParam(req, "code");
    const state = getQueryParam(req, "state");

    if (!code || !state) {
      res.status(400).json({ error: "code and state are required" });
      return;
    }

    // CSRF: the state echoed by Google must equal the one we stored before the
    // redirect. Fail closed on any mismatch; clear the one-time cookie either way.
    const cookies = parseCookieHeader(req.headers.cookie ?? "");
    const expectedState = cookies[OAUTH_STATE_COOKIE];
    res.clearCookie(OAUTH_STATE_COOKIE, { ...getSessionCookieOptions(req), maxAge: -1 });
    if (!expectedState || expectedState !== state) {
      res.status(400).json({ error: "Invalid OAuth state" });
      return;
    }

    if (!isGoogleConfigured()) {
      res.status(503).json({ error: "Google sign-in is not configured" });
      return;
    }

    try {
      const idToken = await exchangeGoogleCode(code, callbackUri(req));
      const profile = await verifyGoogleIdToken(idToken);
      const openId = googleOpenId(profile.sub);

      await db.upsertUser({
        openId,
        name: profile.name,
        email: profile.email,
        loginMethod: "google",
        lastSignedIn: new Date(),
      });

      const sessionToken = await sdk.createSessionToken(openId, {
        name: profile.name || "",
        expiresInMs: ONE_YEAR_MS,
      });

      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });

      res.redirect(302, "/");
    } catch (error) {
      console.error("[OAuth] Google callback failed", error);
      res.status(500).json({ error: "OAuth callback failed" });
    }
  });
}
