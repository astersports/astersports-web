/**
 * Route-level tests for the landing "Aster Scout" SSE endpoint, focused on the
 * capture_lead path: the server must only emit `lead_ack` when the lead email
 * ACTUALLY sent, and fall back to `lead_error` (contact form) otherwise — so it
 * never tells a visitor "we'll be in touch" while silently dropping the lead.
 *
 * Mocks the heavy collaborators (model stream, guard, turnstile, email, env) and
 * drives the captured Express handler directly, mirroring studioStream.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../_core/env", () => ({ ENV: { landingAgentLive: true } }));

vi.mock("../_core/landingAgent/guard", () => ({
  landingAgentGuard: {
    evaluateChatTurn: vi.fn(() => ({ allowed: true })),
    settleChatTurn: vi.fn(),
    evaluateLeadCapture: vi.fn(() => ({ allowed: true })),
    isVerified: vi.fn(() => true),
    markVerified: vi.fn(),
  },
}));

vi.mock("../_core/landingAgent/turnstile", () => ({
  isTurnstileConfigured: vi.fn(() => false),
  verifyTurnstile: vi.fn(async () => true),
}));

vi.mock("../_core/landingAgent/scoutLlm", () => ({
  streamScout: vi.fn(async () => ({
    usage: { inputTokens: 10, outputTokens: 10 },
    toolCalls: [
      { name: "capture_lead", input: { name: "Frank", email: "frank@astersports.co", need: "a team site" } },
    ],
  })),
}));

vi.mock("../email", () => ({ emailLeadCaptured: vi.fn() }));

vi.mock("../serverLog", () => ({ log: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));

import { registerLandingScoutRoute } from "./landingScout";
import { emailLeadCaptured } from "../email";
import { ENV } from "../_core/env";

let routeHandler: (req: any, res: any) => Promise<void>;
let optionsHandler: (req: any, res: any) => void;

function createMockApp() {
  return {
    post: vi.fn((_path: string, handler: any) => {
      routeHandler = handler;
    }),
    options: vi.fn((_path: string, handler: any) => {
      optionsHandler = handler;
    }),
  };
}

function createMockReq(body: any = {}, headers: Record<string, any> = {}) {
  return {
    body,
    headers: { "x-forwarded-for": "1.2.3.4", ...headers },
    socket: { remoteAddress: "1.2.3.4" },
  };
}

function createMockRes() {
  const chunks: string[] = [];
  const headers: Record<string, string> = {};
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    writeHead: vi.fn(),
    setHeader: vi.fn((k: string, v: string) => {
      headers[k] = v;
    }),
    write: vi.fn((chunk: string) => {
      chunks.push(chunk);
      return true;
    }),
    on: vi.fn(),
    end: vi.fn(),
    writableEnded: false,
    _chunks: chunks,
    _headers: headers,
  };
}

/** Parse the SSE `data: {...}` frames the route wrote into the res mock. */
function sseEvents(res: { _chunks: string[] }): Array<Record<string, any>> {
  return res._chunks
    .join("")
    .split("\n\n")
    .map((f) => f.replace(/^data: /, "").trim())
    .filter(Boolean)
    .map((j) => JSON.parse(j));
}

const goodBody = { sessionId: "sess-1", messages: [{ role: "user", content: "I need a site" }] };

describe("registerLandingScoutRoute — capture_lead acknowledgement honesty", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("emits lead_ack ONLY when the email actually sent", async () => {
    (emailLeadCaptured as any).mockResolvedValue(true);
    const app = createMockApp();
    registerLandingScoutRoute(app as any);

    const res = createMockRes();
    await routeHandler(createMockReq(goodBody), res);

    const types = sseEvents(res).map((e) => e.type);
    expect(types).toContain("lead_ack");
    expect(types).not.toContain("lead_error");
  });

  it("emits lead_error (not a false ack) when the email send returns false", async () => {
    (emailLeadCaptured as any).mockResolvedValue(false);
    const app = createMockApp();
    registerLandingScoutRoute(app as any);

    const res = createMockRes();
    await routeHandler(createMockReq(goodBody), res);

    const events = sseEvents(res);
    const types = events.map((e) => e.type);
    expect(types).toContain("lead_error");
    expect(types).not.toContain("lead_ack");
    // and the visitor is pointed at the contact form
    expect(events.find((e) => e.type === "lead_error")?.message).toMatch(/contact form/i);
  });

  it("emits lead_error when the email send throws", async () => {
    (emailLeadCaptured as any).mockRejectedValue(new Error("resend down"));
    const app = createMockApp();
    registerLandingScoutRoute(app as any);

    const res = createMockRes();
    await routeHandler(createMockReq(goodBody), res);

    const types = sseEvents(res).map((e) => e.type);
    expect(types).toContain("lead_error");
    expect(types).not.toContain("lead_ack");
  });
});

const AAU_ORIGIN = "https://legacy-hoopers-production.up.railway.app";

describe("registerLandingScoutRoute — CORS for cross-origin surfaces (AAU hub)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (emailLeadCaptured as any).mockResolvedValue(true);
  });

  it("answers the OPTIONS preflight with 204 + CORS headers for an allowed origin", () => {
    const app = createMockApp();
    registerLandingScoutRoute(app as any);

    const res = createMockRes();
    optionsHandler(createMockReq({}, { origin: AAU_ORIGIN }), res);

    expect(res.status).toHaveBeenCalledWith(204);
    expect(res._headers["Access-Control-Allow-Origin"]).toBe(AAU_ORIGIN);
    expect(res._headers["Access-Control-Allow-Methods"]).toMatch(/POST/);
    expect(res._headers["Access-Control-Allow-Headers"]).toMatch(/Content-Type/i);
  });

  it("does NOT set CORS headers on the preflight for a disallowed origin", () => {
    const app = createMockApp();
    registerLandingScoutRoute(app as any);

    const res = createMockRes();
    optionsHandler(createMockReq({}, { origin: "https://evil.example" }), res);

    expect(res.status).toHaveBeenCalledWith(204);
    expect(res._headers["Access-Control-Allow-Origin"]).toBeUndefined();
  });

  it("stays dark: the OPTIONS preflight 404s when the agent flag is off", () => {
    const app = createMockApp();
    registerLandingScoutRoute(app as any);

    (ENV as { landingAgentLive: boolean }).landingAgentLive = false;
    try {
      const res = createMockRes();
      optionsHandler(createMockReq({}, { origin: AAU_ORIGIN }), res);
      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.status).not.toHaveBeenCalledWith(204);
    } finally {
      (ENV as { landingAgentLive: boolean }).landingAgentLive = true;
    }
  });

  it("echoes the allowed origin on the POST response too", async () => {
    const app = createMockApp();
    registerLandingScoutRoute(app as any);

    const res = createMockRes();
    await routeHandler(createMockReq(goodBody, { origin: AAU_ORIGIN }), res);

    expect(res._headers["Access-Control-Allow-Origin"]).toBe(AAU_ORIGIN);
    expect(res._headers["Vary"]).toBe("Origin");
  });
});
