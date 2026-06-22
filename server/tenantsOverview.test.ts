/**
 * Tests for tenants.overview — the multi-org "Your organizations" feed. Verifies it
 * maps each org to { ...tenant, role, memberCount } and handles the no-org case.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./db", () => ({ getDb: vi.fn(async () => null), getUserByOpenId: vi.fn() }));
vi.mock("./studioDb", () => ({
  getUserTenants: vi.fn(),
  countActiveMembers: vi.fn(),
  createTenant: vi.fn(),
  ensureCategory: vi.fn(),
  createMembership: vi.fn(),
  listMemberships: vi.fn(),
  getTenantById: vi.fn(),
}));

import { tenantsRouter } from "./routers/tenants";
import { getUserTenants, countActiveMembers } from "./studioDb";

const caller = (userId: number) => tenantsRouter.createCaller({ user: { id: userId } } as any);

beforeEach(() => vi.clearAllMocks());

describe("tenants.overview", () => {
  it("enriches each org with role + active member count", async () => {
    (getUserTenants as any).mockResolvedValue([
      { id: 1, name: "Acme", type: "firm", role: "owner", seats: 5, creditBalance: 100 },
      { id: 2, name: "Solo", type: "individual", role: "owner", seats: 1, creditBalance: 50 },
    ]);
    (countActiveMembers as any).mockImplementation(async (id: number) => (id === 1 ? 3 : 1));

    const res = await caller(9).overview();

    expect(res).toHaveLength(2);
    expect(res[0]).toMatchObject({ id: 1, name: "Acme", type: "firm", role: "owner", memberCount: 3 });
    expect(res[1]).toMatchObject({ id: 2, type: "individual", memberCount: 1 });
    expect(countActiveMembers).toHaveBeenCalledTimes(2);
  });

  it("returns an empty list when the user belongs to no orgs", async () => {
    (getUserTenants as any).mockResolvedValue([]);
    const res = await caller(9).overview();
    expect(res).toEqual([]);
    expect(countActiveMembers).not.toHaveBeenCalled();
  });
});
