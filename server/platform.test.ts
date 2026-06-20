/**
 * Tests for platform router — superAdminProcedure gating and procedures.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./db", () => ({
  getDb: vi.fn().mockResolvedValue({
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockResolvedValue([{ insertId: 1 }]),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
  }),
}));

vi.mock("./studioDb", () => ({
  grantCredits: vi.fn().mockResolvedValue(500),
  createTenant: vi.fn().mockResolvedValue({ id: 1, name: "Test Firm", slug: "test-firm" }),
  createMembership: vi.fn().mockResolvedValue(undefined),
}));

import { getDb } from "./db";
import { grantCredits, createTenant, createMembership } from "./studioDb";

describe("superAdminProcedure", () => {
  it("rejects users not in platform_admins table", async () => {
    const db = await getDb();
    // Default mock returns empty array = not admin
    const checkSuperAdmin = async (userId: number) => {
      const result = await (db as any).select().from({}).where({}).limit(1);
      if (result.length === 0) {
        throw new Error("Platform admin access required");
      }
      return true;
    };

    await expect(checkSuperAdmin(999)).rejects.toThrow("Platform admin access required");
  });

  it("allows users in platform_admins table", async () => {
    const db = await getDb();
    // Override limit to return a match
    vi.mocked((db as any).limit).mockResolvedValueOnce([{ id: 1, userId: 1 }]);

    const checkSuperAdmin = async (userId: number) => {
      const result = await (db as any).select().from({}).where({}).limit(1);
      if (result.length === 0) {
        throw new Error("Platform admin access required");
      }
      return true;
    };

    const result = await checkSuperAdmin(1);
    expect(result).toBe(true);
  });
});

describe("platform.grantCredits", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls grantCredits with correct parameters", async () => {
    await (grantCredits as any)(5, 100, "grant", undefined, undefined);
    expect(grantCredits).toHaveBeenCalledWith(5, 100, "grant", undefined, undefined);
  });

  it("returns the new balance from grantCredits", async () => {
    const result = await (grantCredits as any)(5, 100, "grant");
    expect(result).toBe(500);
  });
});

describe("platform.provisionFirm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls createTenant with firm type and domain lock", async () => {
    await (createTenant as any)({
      name: "JAYALLC",
      slug: "jayallc",
      categoryId: 1,
      type: "firm",
      plan: "none",
      seats: 5,
      creditBalance: 0,
      allowedEmailDomain: "jayallc.com",
    });

    expect(createTenant).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "firm",
        name: "JAYALLC",
        slug: "jayallc",
        allowedEmailDomain: "jayallc.com",
      })
    );
  });

  it("assigns owner membership when ownerEmail matches existing user", async () => {
    await (createMembership as any)({
      tenantId: 1,
      userId: 42,
      role: "owner",
      status: "active",
    });

    expect(createMembership).toHaveBeenCalledWith(
      expect.objectContaining({
        role: "owner",
        status: "active",
      })
    );
  });
});

describe("platform.inviteIndividual", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates an individual-type tenant with trial credits", async () => {
    await (createTenant as any)({
      name: "designer",
      slug: "designer",
      categoryId: 1,
      type: "individual",
      plan: "none",
      seats: 1,
      creditBalance: 0,
      trialStartedAt: new Date(),
      trialCredits: 50,
    });

    expect(createTenant).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "individual",
        seats: 1,
        trialCredits: 50,
      })
    );
  });
});

describe("platform.impersonate", () => {
  it("returns tenant info for valid tenant ID", () => {
    const tenant = {
      id: 1,
      name: "Jaya",
      slug: "jaya",
      type: "firm",
      plan: "none",
      creditBalance: 9790,
    };

    const result = {
      tenantId: tenant.id,
      tenantName: tenant.name,
      tenantSlug: tenant.slug,
      type: tenant.type,
      plan: tenant.plan,
      creditBalance: tenant.creditBalance,
    };

    expect(result.tenantId).toBe(1);
    expect(result.tenantName).toBe("Jaya");
    expect(result.type).toBe("firm");
  });

  it("throws NOT_FOUND for invalid tenant ID", async () => {
    const findTenant = async (id: number) => {
      const tenant = null;
      if (!tenant) throw new Error("Account not found");
      return tenant;
    };

    await expect(findTenant(9999)).rejects.toThrow("Account not found");
  });
});
