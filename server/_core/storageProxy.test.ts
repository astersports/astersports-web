/**
 * C1 storage-proxy authorization tests. Exercises the access decision in
 * isolation: capture the route handler, drive it with mock req/res, and mock the
 * auth + ownership lookups. ENV is mocked with forgeApiUrl/forgeApiKey unset so
 * an AUTHORIZED request stops at the "not configured" 500 — that proves it
 * passed the authz gate without needing to mock the Forge presign round-trip.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Express } from "express";

vi.mock("./sdk", () => ({ sdk: { authenticateRequest: vi.fn() } }));
vi.mock("../studioDb", () => ({ getMembership: vi.fn(), getVariationByResultKey: vi.fn() }));
vi.mock("./env", () => ({
  ENV: { forgeApiUrl: "", forgeApiKey: "" },
}));

import { sdk } from "./sdk";
import { getMembership, getVariationByResultKey } from "../studioDb";
import { registerStorageProxy } from "./storageProxy";

const auth = sdk.authenticateRequest as unknown as ReturnType<typeof vi.fn>;
const membership = getMembership as unknown as ReturnType<typeof vi.fn>;
const variationByKey = getVariationByResultKey as unknown as ReturnType<typeof vi.fn>;

/** Capture the GET /manus-storage/* handler that registerStorageProxy installs. */
function getHandler() {
  let handler: any;
  const app = { get: (_path: string, h: any) => { handler = h; } } as unknown as Express;
  registerStorageProxy(app);
  return handler;
}

function mockRes() {
  const res: any = { statusCode: 0, body: undefined, redirectedTo: undefined };
  res.status = vi.fn((c: number) => { res.statusCode = c; return res; });
  res.send = vi.fn((b: any) => { res.body = b; return res; });
  res.set = vi.fn(() => res);
  res.redirect = vi.fn((_c: number, u: string) => { res.redirectedTo = u; return res; });
  return res;
}
const reqFor = (key: string) => ({ params: { 0: key }, headers: {} }) as any;

describe("storageProxy authorization", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("401 when unauthenticated on a private studio/ key", async () => {
    auth.mockRejectedValue(new Error("no session"));
    const res = mockRes();
    await getHandler()(reqFor("studio/42/orig.png"), res);
    expect(res.statusCode).toBe(401);
  });

  it("studio/<tenant>/ key: 403 for a non-member", async () => {
    auth.mockResolvedValue({ id: 7 });
    membership.mockResolvedValue(undefined);
    const res = mockRes();
    await getHandler()(reqFor("studio/42/orig.png"), res);
    expect(membership).toHaveBeenCalledWith(42, 7);
    expect(res.statusCode).toBe(403);
  });

  it("public asset (non-studio, non-variation key): served WITHOUT auth", async () => {
    // The marketing logo + AAU highlight videos flow through /manus-storage/ at
    // root keys and must stay public. They are not variations.
    variationByKey.mockResolvedValue(undefined);
    const res = mockRes();
    await getHandler()(reqFor("aster_sports_logo_high_res_2b537f86.png"), res);
    expect(auth).not.toHaveBeenCalled(); // never required auth
    expect(variationByKey).toHaveBeenCalledWith("aster_sports_logo_high_res_2b537f86.png");
    expect(res.statusCode).toBe(500); // reaches the config gate (forge env mocked empty)
  });

  it("generated/ key owned by another tenant: 403 (cross-tenant IDOR closed)", async () => {
    auth.mockResolvedValue({ id: 7 });
    variationByKey.mockResolvedValue({ tenantId: 99, jobId: 1 });
    membership.mockResolvedValue(undefined);
    const res = mockRes();
    await getHandler()(reqFor("generated/xyz.png"), res);
    expect(membership).toHaveBeenCalledWith(99, 7);
    expect(res.statusCode).toBe(403);
  });

  it("generated/ key owned by the caller's tenant: passes authz (reaches config gate)", async () => {
    auth.mockResolvedValue({ id: 7 });
    variationByKey.mockResolvedValue({ tenantId: 5, jobId: 1 });
    membership.mockResolvedValue({ tenantId: 5, userId: 7, role: "member", status: "active" });
    const res = mockRes();
    await getHandler()(reqFor("generated/xyz.png"), res);
    // Forge env is mocked empty -> the only way to reach this 500 is past authz.
    expect(membership).toHaveBeenCalledWith(5, 7);
    expect(res.statusCode).toBe(500);
  });

  it("generated/ key for an INACTIVE membership: 403 (ex/pending member access revoked)", async () => {
    auth.mockResolvedValue({ id: 7 });
    variationByKey.mockResolvedValue({ tenantId: 5, jobId: 1 });
    membership.mockResolvedValue({ tenantId: 5, userId: 7, role: "member", status: "removed" });
    const res = mockRes();
    await getHandler()(reqFor("generated/xyz.png"), res);
    expect(membership).toHaveBeenCalledWith(5, 7);
    expect(res.statusCode).toBe(403);
  });
});
