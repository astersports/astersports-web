import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Express } from "express";
import { COOKIE_NAME } from "@shared/const";

vi.mock("../db", () => ({ upsertUser: vi.fn() }));
vi.mock("./sdk", () => ({ sdk: { createSessionToken: vi.fn() } }));
vi.mock("./cookies", () => ({
  getSessionCookieOptions: () => ({ httpOnly: true, path: "/", sameSite: "lax", secure: true }),
  isSecureRequest: () => true, // behind TLS -> redirect_uri origin is https
}));
vi.mock("./env", () => ({ ENV: { isProduction: false } }));
vi.mock("./googleAuth", () => ({
  isGoogleConfigured: vi.fn(() => true),
  buildGoogleAuthUrl: vi.fn(() => "https://accounts.google.com/o/oauth2/v2/auth?x=1"),
  exchangeGoogleCode: vi.fn(),
  verifyGoogleIdToken: vi.fn(),
  googleOpenId: (sub: string) => `google:${sub}`,
}));

import * as db from "../db";
import { sdk } from "./sdk";
import {
  isGoogleConfigured,
  buildGoogleAuthUrl,
  exchangeGoogleCode,
  verifyGoogleIdToken,
} from "./googleAuth";
import { registerOAuthRoutes } from "./oauth";

function getHandlers() {
  const handlers: Record<string, any> = {};
  const app = { get: (path: string, h: any) => { handlers[path] = h; } } as unknown as Express;
  registerOAuthRoutes(app);
  return handlers;
}

function mockRes() {
  const res: any = { statusCode: 0, jsonBody: undefined, redirectedTo: undefined, cookies: {}, cleared: [] as string[] };
  res.status = vi.fn((c: number) => { res.statusCode = c; return res; });
  res.json = vi.fn((b: unknown) => { res.jsonBody = b; return res; });
  res.cookie = vi.fn((name: string, val: string, opts: unknown) => { res.cookies[name] = { val, opts }; return res; });
  res.clearCookie = vi.fn((name: string) => { res.cleared.push(name); return res; });
  res.redirect = vi.fn((c: number, u: string) => { res.statusCode = c; res.redirectedTo = u; return res; });
  return res;
}

const reqFor = ({ query = {}, cookie = "" }: { query?: Record<string, string>; cookie?: string } = {}) =>
  ({ query, headers: { cookie }, get: (h: string) => (h === "host" ? "app.example.com" : undefined) }) as any;

describe("Google OAuth routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (isGoogleConfigured as any).mockReturnValue(true);
    (buildGoogleAuthUrl as any).mockReturnValue("https://accounts.google.com/o/oauth2/v2/auth?x=1");
  });

  describe("/api/auth/google/login", () => {
    it("503 when Google is not configured", () => {
      (isGoogleConfigured as any).mockReturnValue(false);
      const res = mockRes();
      getHandlers()["/api/auth/google/login"](reqFor(), res);
      expect(res.statusCode).toBe(503);
    });

    it("sets a state cookie and redirects to Google with that exact state", () => {
      const res = mockRes();
      getHandlers()["/api/auth/google/login"](reqFor(), res);
      const state = res.cookies["oauth_state"]?.val;
      expect(state).toBeTruthy();
      expect(res.redirectedTo).toContain("accounts.google.com");
      // The redirect_uri is built from the request host; the state matches the cookie.
      expect(buildGoogleAuthUrl).toHaveBeenCalledWith("https://app.example.com/api/oauth/callback", state);
    });
  });

  describe("/api/oauth/callback", () => {
    it("400 when code or state is missing", async () => {
      const res = mockRes();
      await getHandlers()["/api/oauth/callback"](reqFor({ query: { code: "c" } }), res);
      expect(res.statusCode).toBe(400);
      expect(exchangeGoogleCode).not.toHaveBeenCalled();
    });

    it("rejects a CSRF state mismatch (cookie != query state) and never exchanges the code", async () => {
      const res = mockRes();
      await getHandlers()["/api/oauth/callback"](
        reqFor({ query: { code: "c", state: "attacker" }, cookie: "oauth_state=legit" }),
        res
      );
      expect(res.cleared).toContain("oauth_state"); // one-time cookie cleared
      expect(res.statusCode).toBe(400);
      expect(exchangeGoogleCode).not.toHaveBeenCalled();
      expect(db.upsertUser).not.toHaveBeenCalled();
    });

    it("happy path: verifies, upserts the google user, mints the session, redirects to /", async () => {
      (exchangeGoogleCode as any).mockResolvedValue("id.token.jwt");
      (verifyGoogleIdToken as any).mockResolvedValue({
        sub: "123", email: "a@b.com", name: "Ada", emailVerified: true,
      });
      (sdk.createSessionToken as any).mockResolvedValue("session.jwt");

      const res = mockRes();
      await getHandlers()["/api/oauth/callback"](
        reqFor({ query: { code: "auth-code", state: "s" }, cookie: "oauth_state=s" }),
        res
      );

      expect(exchangeGoogleCode).toHaveBeenCalledWith("auth-code", "https://app.example.com/api/oauth/callback");
      expect(db.upsertUser).toHaveBeenCalledWith(
        expect.objectContaining({ openId: "google:123", email: "a@b.com", name: "Ada", loginMethod: "google" })
      );
      expect(sdk.createSessionToken).toHaveBeenCalledWith("google:123", expect.objectContaining({ name: "Ada" }));
      expect(res.cookies[COOKIE_NAME]?.val).toBe("session.jwt");
      expect(res.redirectedTo).toBe("/");
    });
  });
});
