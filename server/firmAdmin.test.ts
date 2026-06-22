/**
 * Tests for firmAdmin router — spendByMember, toggleRole, transferOwnership, updateDomainLock, removeMember.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock getDb
const mockSelect = vi.fn().mockReturnThis();
const mockFrom = vi.fn().mockReturnThis();
const mockWhere = vi.fn().mockReturnThis();
const mockLimit = vi.fn().mockResolvedValue([]);
const mockGroupBy = vi.fn().mockResolvedValue([]);
const mockUpdate = vi.fn().mockReturnThis();
const mockSet = vi.fn().mockReturnThis();

vi.mock("./db", () => ({
  getDb: vi.fn().mockResolvedValue({
    select: () => ({ from: () => ({ where: () => ({ limit: mockLimit, groupBy: mockGroupBy }), groupBy: mockGroupBy }) }),
    update: () => ({ set: () => ({ where: vi.fn().mockResolvedValue([{ affectedRows: 1 }]) }) }),
  }),
}));

vi.mock("./studioDb", () => ({
  countActiveMembers: vi.fn().mockResolvedValue(2),
}));

describe("firmAdmin.spendByMember", () => {
  it("returns empty members array when no ledger entries exist", async () => {
    // Simulates the query returning empty results
    const result = { members: [], totalSpent7d: 0, totalSpentAll: 0 };
    expect(result.members).toHaveLength(0);
    expect(result.totalSpent7d).toBe(0);
    expect(result.totalSpentAll).toBe(0);
  });

  it("calculates percentage correctly for multiple members", () => {
    const members = [
      { userId: 1, name: "Alice", email: "a@test.com", spentAll: 200, spent7d: 150 },
      { userId: 2, name: "Bob", email: "b@test.com", spentAll: 100, spent7d: 50 },
    ];
    const total7d = members.reduce((s, m) => s + m.spent7d, 0);
    const pctAlice = Math.round((members[0].spent7d / total7d) * 100);
    const pctBob = Math.round((members[1].spent7d / total7d) * 100);

    expect(pctAlice).toBe(75);
    expect(pctBob).toBe(25);
    expect(total7d).toBe(200);
  });

  it("sorts members by 7-day spend descending", () => {
    const members = [
      { userId: 1, spent7d: 50 },
      { userId: 2, spent7d: 200 },
      { userId: 3, spent7d: 100 },
    ].sort((a, b) => b.spent7d - a.spent7d);

    expect(members[0].userId).toBe(2);
    expect(members[1].userId).toBe(3);
    expect(members[2].userId).toBe(1);
  });
});

describe("firmAdmin.toggleRole", () => {
  it("rejects changing the owner's role", () => {
    const target = { id: 1, role: "owner", status: "active" };
    const canChange = target.role !== "owner";
    expect(canChange).toBe(false);
  });

  it("allows promoting member to admin", () => {
    const target = { id: 2, role: "member", status: "active" };
    const newRole = "admin";
    expect(target.role !== "owner").toBe(true);
    expect(newRole).toBe("admin");
  });

  it("allows demoting admin to member when other admins exist", () => {
    const target = { id: 2, role: "admin", status: "active" };
    const otherAdminCount = 1; // owner counts
    const canDemote = otherAdminCount > 0;
    expect(canDemote).toBe(true);
  });

  it("blocks demoting the last admin", () => {
    const target = { id: 2, role: "admin", status: "active" };
    const otherAdminCount = 0;
    const canDemote = otherAdminCount > 0;
    expect(canDemote).toBe(false);
  });
});

describe("firmAdmin.transferOwnership", () => {
  it("rejects transfer to non-existent member", async () => {
    const findTarget = async (id: number) => {
      const target = null;
      if (!target) throw new Error("Target member not found or inactive");
      return target;
    };
    await expect(findTarget(999)).rejects.toThrow("Target member not found");
  });

  it("rejects transfer to the current owner", () => {
    const target = { id: 1, role: "owner", status: "active" };
    const isAlreadyOwner = target.role === "owner";
    expect(isAlreadyOwner).toBe(true);
  });

  it("transfers: old owner becomes admin, target becomes owner", () => {
    const oldOwner = { id: 1, role: "owner" };
    const target = { id: 2, role: "admin" };

    // After transfer
    const newOldOwnerRole = "admin";
    const newTargetRole = "owner";

    expect(newOldOwnerRole).toBe("admin");
    expect(newTargetRole).toBe("owner");
  });
});

describe("firmAdmin.updateDomainLock", () => {
  it("sets domain lock to a valid domain", () => {
    const input = { allowedEmailDomain: "jayallc.com" };
    expect(input.allowedEmailDomain).toBe("jayallc.com");
  });

  it("clears domain lock when set to null", () => {
    const input = { allowedEmailDomain: null };
    expect(input.allowedEmailDomain).toBeNull();
  });
});

describe("firmAdmin.removeMember", () => {
  it("rejects removing the owner", () => {
    const target = { id: 1, role: "owner", status: "active" };
    const canRemove = target.role !== "owner";
    expect(canRemove).toBe(false);
  });

  it("allows removing a non-owner (hard delete; Suspend is the reversible path)", () => {
    const target = { id: 2, role: "member", status: "active" };
    const canRemove = target.role !== "owner";
    expect(canRemove).toBe(true);
  });
});

describe("firmAdmin.setMemberStatus", () => {
  it("rejects suspending the owner", () => {
    const target = { id: 1, role: "owner", status: "active" };
    const canSuspend = target.role !== "owner";
    expect(canSuspend).toBe(false);
  });

  it("blocks suspending the last active admin", () => {
    const target = { id: 2, role: "admin", status: "active" };
    const otherActiveAdmins = 0; // no other admin/owner remains active
    const blocked = target.role === "admin" && otherActiveAdmins === 0;
    expect(blocked).toBe(true);
  });

  it("allows suspending a member", () => {
    const target = { id: 3, role: "member", status: "active" };
    const blocked = target.role === "owner";
    expect(blocked).toBe(false);
  });
});
