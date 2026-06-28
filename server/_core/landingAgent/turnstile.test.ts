import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the env module so we can drive the secret presence per-test. Both this
// file and turnstile.ts import the same `../env` specifier, so they share the
// mocked ENV object — mutating it here changes what verifyTurnstile reads.
vi.mock("../env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../env")>();
  return { ...actual, ENV: { ...actual.ENV, turnstileSecretKey: "" } };
});

import { ENV } from "../env";
import { parseTurnstileResult, isTurnstileConfigured, verifyTurnstile } from "./turnstile";

const siteverify = (json: unknown, status = 200) =>
  vi.fn().mockResolvedValue(new Response(JSON.stringify(json), { status }));

describe("parseTurnstileResult", () => {
  it("passes ONLY on an explicit success:true", () => {
    expect(parseTurnstileResult({ success: true }).success).toBe(true);
  });

  it.each([
    [{ success: false }],
    [{ success: "true" }], // string, not boolean — must not pass
    [{ success: 1 }],
    [{}],
    [null],
    [undefined],
    ["nope"],
    [42],
  ])("fails closed on a non-true success (%o)", (json) => {
    expect(parseTurnstileResult(json).success).toBe(false);
  });
});

describe("isTurnstileConfigured", () => {
  afterEach(() => {
    ENV.turnstileSecretKey = "";
  });

  it("is false with no secret", () => {
    ENV.turnstileSecretKey = "";
    expect(isTurnstileConfigured()).toBe(false);
  });

  it("is true once the secret is set", () => {
    ENV.turnstileSecretKey = "1x0000000000000000000000000000000AA";
    expect(isTurnstileConfigured()).toBe(true);
  });
});

describe("verifyTurnstile (fail closed)", () => {
  beforeEach(() => {
    ENV.turnstileSecretKey = "test-secret";
  });
  afterEach(() => {
    ENV.turnstileSecretKey = "";
    vi.unstubAllGlobals();
  });

  it("returns false when no secret is configured (never calls Cloudflare)", async () => {
    ENV.turnstileSecretKey = "";
    const fetchSpy = siteverify({ success: true });
    vi.stubGlobal("fetch", fetchSpy);
    expect(await verifyTurnstile("token", "1.1.1.1")).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns false when the token is missing/empty", async () => {
    const fetchSpy = siteverify({ success: true });
    vi.stubGlobal("fetch", fetchSpy);
    expect(await verifyTurnstile(undefined, "1.1.1.1")).toBe(false);
    expect(await verifyTurnstile("", "1.1.1.1")).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns true on an explicit success verdict", async () => {
    vi.stubGlobal("fetch", siteverify({ success: true }));
    expect(await verifyTurnstile("good-token", "1.1.1.1")).toBe(true);
  });

  it("returns false on a non-success verdict", async () => {
    vi.stubGlobal("fetch", siteverify({ success: false, "error-codes": ["invalid-input-response"] }));
    expect(await verifyTurnstile("bad-token", "1.1.1.1")).toBe(false);
  });

  it("returns false on a non-OK HTTP response", async () => {
    vi.stubGlobal("fetch", siteverify({ success: true }, 500));
    expect(await verifyTurnstile("token", "1.1.1.1")).toBe(false);
  });

  it("returns false when fetch throws (network error)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    expect(await verifyTurnstile("token", "1.1.1.1")).toBe(false);
  });

  it("omits remoteip when the IP is unknown", async () => {
    const fetchSpy = siteverify({ success: true });
    vi.stubGlobal("fetch", fetchSpy);
    await verifyTurnstile("token", "unknown");
    const body = fetchSpy.mock.calls[0][1].body as URLSearchParams;
    expect(body.has("remoteip")).toBe(false);
    expect(body.get("response")).toBe("token");
  });
});
