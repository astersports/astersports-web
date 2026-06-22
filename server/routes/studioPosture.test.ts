import { describe, it, expect, vi, beforeEach } from "vitest";

const SECRET = "cron-secret-value-1234567890";
const TOKEN = "replicate-token-must-not-leak";

// NOTE: literals inline — the factory is hoisted above the SECRET/TOKEN consts.
vi.mock("../_core/env", () => ({
  ENV: {
    cronSecret: "cron-secret-value-1234567890",
    studioScaleLive: false,
    studioDensityLive: false,
    studioDensityRedistribute: false,
    maskProvider: "sam2",
    replicateApiToken: "replicate-token-must-not-leak",
    replicateSam2Model: "meta/sam-2",
    studioNoOpGuard: true,
    studioSam2PointsPerSide: 32,
    studioSam2UseM2m: false,
    studioMaxInstances: 200,
  },
}));
vi.mock("../_core/masking", () => ({ getMaskProvider: vi.fn(() => ({ rasterReady: true })) }));

import { registerStudioPostureRoute } from "./studioPosture";
import { ENV } from "../_core/env";

let handler: (req: any, res: any) => void;
function app() {
  return { get: vi.fn((_p: string, h: any) => { handler = h; }) } as any;
}
function res() {
  return { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
}

describe("GET /api/studio/posture", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ENV.cronSecret = SECRET;
    ENV.studioScaleLive = false;
    ENV.studioDensityLive = false;
    ENV.studioDensityRedistribute = false;
  });

  it("403 when the x-cron-secret header is missing or wrong", () => {
    registerStudioPostureRoute(app());
    const r1 = res(); handler({ headers: {} }, r1);
    expect(r1.status).toHaveBeenCalledWith(403);
    const r2 = res(); handler({ headers: { "x-cron-secret": "nope" } }, r2);
    expect(r2.status).toHaveBeenCalledWith(403);
  });

  it("403 (fail-closed) when CRON_SECRET is unset — never leaks posture publicly", () => {
    ENV.cronSecret = "";
    registerStudioPostureRoute(app());
    const r = res();
    handler({ headers: { "x-cron-secret": "" } }, r);
    expect(r.status).toHaveBeenCalledWith(403);
    expect(r.json).toHaveBeenCalledWith({ error: "forbidden" });
  });

  it("200 with the dark posture when the secret matches", () => {
    registerStudioPostureRoute(app());
    const r = res();
    handler({ headers: { "x-cron-secret": SECRET } }, r);
    expect(r.status).not.toHaveBeenCalledWith(403);
    const body = (r.json as any).mock.calls[0][0];
    expect(body.flags).toEqual({ scaleLive: false, densityLive: false, densityRedistribute: false });
    expect(body.dark).toBe(true);
    expect(body.maskProvider).toBe("sam2");
    expect(body.rasterReady).toBe(true);
    expect(body.replicateConfigured).toBe(true);
    expect(body.effective).toEqual({ scaleLive: false, densityLive: false });
  });

  it("reports effective=true only when flag AND rasterReady, and never leaks secret/token values", () => {
    ENV.studioScaleLive = true;
    registerStudioPostureRoute(app());
    const r = res();
    handler({ headers: { "x-cron-secret": SECRET } }, r);
    const body = (r.json as any).mock.calls[0][0];
    expect(body.flags.scaleLive).toBe(true);
    expect(body.dark).toBe(false);
    expect(body.effective.scaleLive).toBe(true); // flag true + rasterReady true
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain(TOKEN);
    expect(serialized).not.toContain(SECRET);
  });
});
