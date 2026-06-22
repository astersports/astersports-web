/**
 * Tests for tenants.create — ledger-safe, rate-limited, dark-by-default self-serve
 * org creation (re-enabled 2026-06-22 after the M2 removal). Guards:
 *  - dark gate: FORBIDDEN unless STUDIO_CREATE_ORG_LIVE is on;
 *  - ledger safety: provisions creditBalance:0 + grants via grantCredits (NEVER a
 *    direct creditBalance write — the M2 drift regression guard);
 *  - rate limits: lifetime + 24h burst caps → TOO_MANY_REQUESTS;
 *  - best-effort teardown when downstream provisioning throws.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./db", () => ({ getDb: vi.fn(async () => null), getUserByOpenId: vi.fn() }));
vi.mock("./_core/env", () => ({ ENV: { studioCreateOrgLive: false } }));
vi.mock("./studioDb", () => ({
  getUserTenants: vi.fn(),
  createTenant: vi.fn(),
  ensureCategory: vi.fn(),
  createMembership: vi.fn(),
  listMemberships: vi.fn(),
  countActiveMembers: vi.fn(),
  countUserOwnedTenants: vi.fn(async () => 0),
  countUserOwnedTenantsSince: vi.fn(async () => 0),
  deleteTenantCascade: vi.fn(),
  grantCredits: vi.fn(async () => 150),
}));

import { tenantsRouter } from "./routers/tenants";
import { ENV } from "./_core/env";
import {
  createTenant,
  ensureCategory,
  createMembership,
  grantCredits,
  countUserOwnedTenants,
  countUserOwnedTenantsSince,
  deleteTenantCascade,
} from "./studioDb";
import { TRIAL_CREDITS } from "../shared/billing";

const caller = (userId: number) => tenantsRouter.createCaller({ user: { id: userId } } as any);

beforeEach(() => {
  vi.clearAllMocks();
  (ENV as any).studioCreateOrgLive = true;
  (countUserOwnedTenants as any).mockResolvedValue(0);
  (countUserOwnedTenantsSince as any).mockResolvedValue(0);
  (ensureCategory as any).mockResolvedValue({ id: 1, name: "Default", slug: "default" });
  (createTenant as any).mockResolvedValue({ id: 42, name: "Acme Design Co", type: "firm", creditBalance: 0 });
  (grantCredits as any).mockResolvedValue(TRIAL_CREDITS);
});

describe("tenants.create — dark gate (F1, Flip Authority)", () => {
  it("throws FORBIDDEN and provisions nothing when STUDIO_CREATE_ORG_LIVE is off", async () => {
    (ENV as any).studioCreateOrgLive = false;
    await expect(caller(7).create({ name: "Acme Design Co" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(createTenant).not.toHaveBeenCalled();
    expect(grantCredits).not.toHaveBeenCalled();
  });
});

describe("tenants.create — ledger-safe provisioning (F3/F4)", () => {
  it("seeds creditBalance:0 and grants TRIAL_CREDITS through grantCredits (no direct balance write)", async () => {
    const res = await caller(7).create({ name: "Acme Design Co" });

    // M2 regression guard: balance starts at 0, type firm, trial seeded.
    expect(createTenant).toHaveBeenCalledWith(
      expect.objectContaining({ type: "firm", creditBalance: 0, trialCredits: TRIAL_CREDITS })
    );
    // Owner membership for the creator.
    expect(createMembership).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 42, userId: 7, role: "owner", status: "active" })
    );
    // Credits flow ONLY through grantCredits (balance + ledger in one tx),
    // idempotent on a per-tenant refId, attributed to the creator.
    expect(grantCredits).toHaveBeenCalledWith(42, TRIAL_CREDITS, "trial_creation", "signup-trial-42", 7);
    expect(res).toMatchObject({ id: 42 });
  });

  it("tears down the tenant (best-effort) when the trial grant fails, and surfaces the error", async () => {
    (grantCredits as any).mockRejectedValue(new Error("grant boom"));
    await expect(caller(7).create({ name: "Acme Design Co" })).rejects.toThrow("grant boom");
    expect(deleteTenantCascade).toHaveBeenCalledWith(42);
  });
});

describe("tenants.create — rate limits (F2)", () => {
  it("throws TOO_MANY_REQUESTS at the lifetime cap (2 owned) without provisioning", async () => {
    (countUserOwnedTenants as any).mockResolvedValue(2);
    await expect(caller(7).create({ name: "Third Org" })).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
    expect(createTenant).not.toHaveBeenCalled();
  });

  it("throws TOO_MANY_REQUESTS at the 24h burst cap (3 recent) without provisioning", async () => {
    (countUserOwnedTenants as any).mockResolvedValue(1); // under lifetime cap
    (countUserOwnedTenantsSince as any).mockResolvedValue(3); // at burst cap
    await expect(caller(7).create({ name: "Burst Org" })).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
    expect(createTenant).not.toHaveBeenCalled();
  });
});
