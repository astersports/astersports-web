import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies before importing
vi.mock("./db", () => ({
  getDb: vi.fn(),
}));

vi.mock("../drizzle/schema", () => ({
  serverLogs: { createdAt: "createdAt", id: "id" },
}));

vi.mock("drizzle-orm", () => ({
  lt: vi.fn((col, val) => ({ operator: "lt", column: col, value: val })),
}));

import { pruneOldLogs, RETENTION_MS } from "./logRetention";
import { getDb } from "./db";
import { lt } from "drizzle-orm";

describe("logRetention", () => {
  let mockReturning: ReturnType<typeof vi.fn>;
  let mockWhere: ReturnType<typeof vi.fn>;
  let mockDelete: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    // Postgres: .delete().where().returning() yields one row per deleted record (length = count).
    mockReturning = vi.fn().mockResolvedValue(new Array(15).fill({ id: 1 }));
    mockWhere = vi.fn().mockReturnValue({ returning: mockReturning });
    mockDelete = vi.fn().mockReturnValue({ where: mockWhere });
    (getDb as any).mockResolvedValue({ delete: mockDelete });
  });

  it("RETENTION_MS equals 30 days in milliseconds", () => {
    expect(RETENTION_MS).toBe(30 * 24 * 60 * 60 * 1000);
  });

  it("deletes rows older than 30 days", async () => {
    const before = Date.now();
    const result = await pruneOldLogs();
    const after = Date.now();

    expect(result).toBe(15);
    expect(mockDelete).toHaveBeenCalledWith(expect.anything()); // serverLogs table
    expect(mockWhere).toHaveBeenCalledTimes(1);

    // Verify lt() was called with the createdAt column and a Date ~30 days ago
    expect(lt).toHaveBeenCalledTimes(1);
    const ltArgs = (lt as any).mock.calls[0];
    expect(ltArgs[0]).toBe("createdAt"); // serverLogs.createdAt mock
    const cutoffDate = ltArgs[1] as Date;
    expect(cutoffDate).toBeInstanceOf(Date);

    // Cutoff should be approximately 30 days before now (within 1 second tolerance)
    const expectedCutoff = before - RETENTION_MS;
    expect(cutoffDate.getTime()).toBeGreaterThanOrEqual(expectedCutoff - 1000);
    expect(cutoffDate.getTime()).toBeLessThanOrEqual(after - RETENTION_MS + 1000);
  });

  it("returns -1 when database is unavailable", async () => {
    (getDb as any).mockResolvedValue(null);

    const result = await pruneOldLogs();

    expect(result).toBe(-1);
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it("returns 0 when no rows match the cutoff", async () => {
    mockReturning.mockResolvedValue([]);

    const result = await pruneOldLogs();

    expect(result).toBe(0);
  });

  it("handles large deletion counts", async () => {
    mockReturning.mockResolvedValue(new Array(50000).fill({ id: 1 }));

    const result = await pruneOldLogs();

    expect(result).toBe(50000);
  });

  it("propagates database errors", async () => {
    mockReturning.mockRejectedValue(new Error("Connection lost"));

    await expect(pruneOldLogs()).rejects.toThrow("Connection lost");
  });
});
