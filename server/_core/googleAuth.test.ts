import { describe, it, expect, vi, beforeEach } from "vitest";

const mockEnv = vi.hoisted(() => ({
  googleClientId: "client-123.apps.googleusercontent.com",
  googleClientSecret: "secret-xyz",
}));
vi.mock("./env", () => ({ ENV: mockEnv }));

import {
  buildGoogleAuthUrl,
  exchangeGoogleCode,
  googleOpenId,
  isGoogleConfigured,
  verifyGoogleIdToken,
} from "./googleAuth";

describe("googleAuth", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockEnv.googleClientId = "client-123.apps.googleusercontent.com";
    mockEnv.googleClientSecret = "secret-xyz";
  });

  it("isGoogleConfigured requires both id and secret", () => {
    expect(isGoogleConfigured()).toBe(true);
    mockEnv.googleClientSecret = "";
    expect(isGoogleConfigured()).toBe(false);
  });

  it("googleOpenId namespaces the subject", () => {
    expect(googleOpenId("110248495921238986420")).toBe("google:110248495921238986420");
  });

  it("buildGoogleAuthUrl sets the OAuth 2.0 params (incl. the CSRF state)", () => {
    const url = new URL(buildGoogleAuthUrl("https://app.example.com/api/oauth/callback", "state-abc"));
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("client_id")).toBe("client-123.apps.googleusercontent.com");
    expect(url.searchParams.get("redirect_uri")).toBe("https://app.example.com/api/oauth/callback");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("scope")).toBe("openid email profile");
    expect(url.searchParams.get("state")).toBe("state-abc");
  });

  it("exchangeGoogleCode posts the code (+secret) and returns the id_token", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id_token: "the.jwt.token" }), { status: 200 })
    );
    const idToken = await exchangeGoogleCode("auth-code", "https://app/cb");
    expect(idToken).toBe("the.jwt.token");

    const [endpoint, init] = fetchSpy.mock.calls[0];
    expect(endpoint).toBe("https://oauth2.googleapis.com/token");
    const body = init!.body as URLSearchParams;
    expect(body.get("code")).toBe("auth-code");
    expect(body.get("redirect_uri")).toBe("https://app/cb");
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("client_secret")).toBe("secret-xyz");
  });

  it("exchangeGoogleCode throws on a non-ok token response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("nope", { status: 400 }));
    await expect(exchangeGoogleCode("c", "u")).rejects.toThrow(/Google token exchange failed/);
  });

  it("exchangeGoogleCode throws when id_token is missing", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ access_token: "x" }), { status: 200 })
    );
    await expect(exchangeGoogleCode("c", "u")).rejects.toThrow(/missing id_token/);
  });

  it("verifyGoogleIdToken rejects a token not signed by Google (malformed -> no JWKS fetch)", async () => {
    await expect(verifyGoogleIdToken("garbage")).rejects.toBeTruthy();
  });
});
