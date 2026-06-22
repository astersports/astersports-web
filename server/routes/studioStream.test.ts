/**
 * Unit tests for the SSE studio stream endpoint.
 * Tests the route registration, auth, validation, and SSE event framing.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies before importing the module under test
vi.mock("../_core/sdk", () => ({
  sdk: {
    authenticateRequest: vi.fn(),
  },
}));

vi.mock("../_core/env", () => ({
  ENV: {
    studioDensityLive: true,
    studioDensityRedistribute: false,
    studioScaleLive: false,
    studioRecolorLive: false,
  },
}));

vi.mock("../_core/masking", () => ({
  getMaskProvider: vi.fn(() => ({ rasterReady: false })),
}));

vi.mock("../_core/studio/guards/dpiGuard", () => ({
  checkUpscaleDpi: vi.fn(async () => ({ reject: false })),
}));

vi.mock("../storage", () => ({
  storageGetSignedUrl: vi.fn(async (key: string) => `https://signed.url/${key}`),
}));

vi.mock("../studioEngine", () => ({
  runVariation: vi.fn(async () => ({ url: "/manus-storage/result.png", key: "result.png" })),
}));

vi.mock("../studioDb", () => ({
  getTenantById: vi.fn(async (id: number) => ({
    id,
    creditBalance: 1000,
    trialStartedAt: null,
    trialCredits: 0,
  })),
  getMembership: vi.fn(async () => ({ id: 1, userId: 1, tenantId: 1, role: "owner", status: "active" })),
  getJob: vi.fn(async (id: number) => ({
    id,
    tenantId: 1,
    originalUrl: "/manus-storage/original.png",
    status: "uploaded",
  })),
  updateJobStatus: vi.fn(async () => {}),
  deductCredits: vi.fn(async () => 990),
  grantCredits: vi.fn(async () => 1000),
  countJobGenerationAttempts: vi.fn(async () => 0),
  getTrialStatus: vi.fn(() => ({ inTrial: false, daysRemaining: 0, trialDay: 0, expired: false })),
}));

vi.mock("../impersonation", () => ({
  getImpersonationFromRequest: vi.fn(async () => null),
}));

vi.mock("../serverLog", () => ({
  log: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

import { registerStudioStreamRoutes } from "./studioStream";
import { sdk } from "../_core/sdk";
import { runVariation } from "../studioEngine";

// Capture the registered route handler
let routeHandler: (req: any, res: any) => Promise<void>;

function createMockApp() {
  return {
    post: vi.fn((path: string, handler: any) => {
      routeHandler = handler;
    }),
  };
}

function createMockReq(body: any = {}) {
  const listeners: Record<string, Function[]> = {};
  return {
    body,
    headers: { cookie: "session=abc" },
    socket: { setTimeout: vi.fn() },
    on: vi.fn((event: string, cb: Function) => {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(cb);
    }),
    _emit: (event: string) => {
      (listeners[event] || []).forEach((cb) => cb());
    },
  };
}

function createMockRes() {
  const chunks: string[] = [];
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    writeHead: vi.fn(),
    flushHeaders: vi.fn(),
    write: vi.fn((chunk: string) => {
      chunks.push(chunk);
      return true;
    }),
    end: vi.fn(),
    writableEnded: false,
    _chunks: chunks,
  };
}

describe("registerStudioStreamRoutes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("registers a POST route at /api/studio/generate-stream", () => {
    const app = createMockApp();
    registerStudioStreamRoutes(app as any);
    expect(app.post).toHaveBeenCalledWith("/api/studio/generate-stream", expect.any(Function));
  });

  it("returns 401 when auth fails", async () => {
    const app = createMockApp();
    registerStudioStreamRoutes(app as any);

    (sdk.authenticateRequest as any).mockRejectedValue(new Error("Unauthorized"));

    const req = createMockReq({});
    const res = createMockRes();

    await routeHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: "Unauthorized" });
  });

  it("returns 400 when tenantId or jobId is missing", async () => {
    const app = createMockApp();
    registerStudioStreamRoutes(app as any);

    (sdk.authenticateRequest as any).mockResolvedValue({ id: 1, name: "Test" });

    const req = createMockReq({ controls: {} });
    const res = createMockRes();

    await routeHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: "Missing tenantId or jobId" });
  });

  it("returns 400 when controls are not density-only or scale-only", async () => {
    const app = createMockApp();
    registerStudioStreamRoutes(app as any);

    (sdk.authenticateRequest as any).mockResolvedValue({ id: 1, name: "Test" });

    const req = createMockReq({
      tenantId: 1,
      jobId: 1,
      controls: {
        scale: { enabled: false, percent: 0 },
        density: { enabled: false, percent: 0 },
        remove: { enabled: true, element: "flowers", percent: 50 },
        recolor: { enabled: false, element: "", fromColor: "", targetColor: "", coverage: 100 },
      },
    });
    const res = createMockRes();

    await routeHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining("temporarily unavailable") })
    );
  });

  it("streams SSE events for a successful density generation", async () => {
    const app = createMockApp();
    registerStudioStreamRoutes(app as any);

    (sdk.authenticateRequest as any).mockResolvedValue({ id: 1, name: "Test" });
    (runVariation as any).mockResolvedValue({ url: "/manus-storage/density-1.png", key: "density-1.png" });

    const req = createMockReq({
      tenantId: 1,
      jobId: 1,
      controls: {
        scale: { enabled: false, percent: 0 },
        density: { enabled: true, percent: 30 },
        remove: { enabled: false, element: "", percent: 0 },
        recolor: { enabled: false, element: "", fromColor: "", targetColor: "", coverage: 100 },
      },
    });
    const res = createMockRes();

    await routeHandler(req, res);

    // Should have set SSE headers
    expect(res.writeHead).toHaveBeenCalledWith(200, expect.objectContaining({
      "Content-Type": "text/event-stream",
    }));

    // Should have sent at least "started" and "done" events
    const allData = res._chunks.join("");
    expect(allData).toContain('"type":"started"');
    expect(allData).toContain('"type":"done"');
    expect(allData).toContain('"density-1.png"');

    // Should have ended the response
    expect(res.end).toHaveBeenCalled();
  });

  it("streams an error event and refunds on generation failure", async () => {
    const app = createMockApp();
    registerStudioStreamRoutes(app as any);

    (sdk.authenticateRequest as any).mockResolvedValue({ id: 1, name: "Test" });
    (runVariation as any).mockRejectedValue(new Error("SAM2 timeout"));

    const req = createMockReq({
      tenantId: 1,
      jobId: 1,
      controls: {
        scale: { enabled: false, percent: 0 },
        density: { enabled: true, percent: 30 },
        remove: { enabled: false, element: "", percent: 0 },
        recolor: { enabled: false, element: "", fromColor: "", targetColor: "", coverage: 100 },
      },
    });
    const res = createMockRes();

    await routeHandler(req, res);

    const allData = res._chunks.join("");
    expect(allData).toContain('"type":"started"');
    expect(allData).toContain('"type":"error"');
    expect(allData).toContain("SAM2 timeout");
    expect(allData).toContain('"refunded":true');

    // Should have called grantCredits for refund
    const { grantCredits } = await import("../studioDb");
    expect(grantCredits).toHaveBeenCalled();
  });
});
