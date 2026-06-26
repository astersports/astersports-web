/**
 * Audit-log writer invariant: best-effort, never throws into the caller. A
 * failed (or DB-unavailable) audit write must NOT roll back or block the
 * super-admin action it records — it returns false and logs, never throws.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const getDb = vi.fn();
vi.mock("./db", () => ({ getDb: () => getDb() }));
// Keep the server logger quiet + side-effect-free in this unit test.
vi.mock("./serverLog", () => ({
  log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import { writeAuditLog } from "./auditLog";

describe("writeAuditLog (best-effort, never throws)", () => {
  beforeEach(() => getDb.mockReset());

  it("returns false (does not throw) when the DB is unavailable", async () => {
    getDb.mockResolvedValue(null);
    await expect(
      writeAuditLog({ actorUserId: 1, action: "impersonation_started", summary: "x" })
    ).resolves.toBe(false);
  });

  it("returns false (does not throw) when the insert rejects", async () => {
    getDb.mockResolvedValue({
      insert: () => ({ values: () => Promise.reject(new Error("boom")) }),
    });
    await expect(
      writeAuditLog({ actorUserId: 1, action: "credit_grant", summary: "x" })
    ).resolves.toBe(false);
  });

  it("returns true and inserts the row when the DB write succeeds", async () => {
    const values = vi.fn().mockResolvedValue(undefined);
    getDb.mockResolvedValue({ insert: () => ({ values }) });
    await expect(
      writeAuditLog({
        actorUserId: 7,
        action: "org_provisioned",
        summary: 'Provisioned firm "Jaya LLC"',
        targetTenantId: 42,
      })
    ).resolves.toBe(true);
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: 7,
        action: "org_provisioned",
        targetTenantId: 42,
        targetUserId: null,
        metadata: null,
      })
    );
  });
});
