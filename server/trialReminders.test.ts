import { describe, it, expect, vi, beforeEach } from "vitest";

// Static mocks — no top-level variables in factory
vi.mock("./db", () => ({
  getDb: vi.fn(),
}));

vi.mock("./_core/notification", () => ({
  notifyOwner: vi.fn(),
}));

describe("trialReminders", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("buildReminderContent", () => {
    it("builds Day 4 content with correct title and body", async () => {
      const { buildReminderContent } = await import("./trialReminders");
      const result = buildReminderContent("JAYALLC", 4, 3, 20, 50);

      expect(result.title).toBe("Trial Halfway — JAYALLC");
      expect(result.content).toContain("halfway through (Day 4 of 7)");
      expect(result.content).toContain("Credits used: 20 of 50");
      expect(result.content).toContain("Days remaining: 3");
      expect(result.content).toContain("card on file will be charged on Day 7");
    });

    it("builds Day 6 content with correct title and body", async () => {
      const { buildReminderContent } = await import("./trialReminders");
      const result = buildReminderContent("TestFirm", 6, 1, 45, 50);

      expect(result.title).toBe("Trial Ends Tomorrow — TestFirm");
      expect(result.content).toContain("ends tomorrow (Day 6 of 7)");
      expect(result.content).toContain("Credits used: 45 of 50");
      expect(result.content).toContain("charged tomorrow unless the trial is cancelled");
      expect(result.content).toContain("final reminder");
    });

    it("handles zero credits used", async () => {
      const { buildReminderContent } = await import("./trialReminders");
      const result = buildReminderContent("NewFirm", 4, 3, 0, 50);

      expect(result.content).toContain("Credits used: 0 of 50");
    });

    it("handles all credits used", async () => {
      const { buildReminderContent } = await import("./trialReminders");
      const result = buildReminderContent("ActiveFirm", 6, 1, 50, 50);

      expect(result.content).toContain("Credits used: 50 of 50");
    });
  });

  describe("processTrialReminders", () => {
    it("throws when database is unavailable", async () => {
      const { getDb } = await import("./db");
      (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const { processTrialReminders } = await import("./trialReminders");
      await expect(processTrialReminders()).rejects.toThrow("Database unavailable");
    });

    it("returns empty results when no tenants are in trial", async () => {
      const mockDb = {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([]),
      };

      const { getDb } = await import("./db");
      (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(mockDb);

      const { processTrialReminders } = await import("./trialReminders");
      const result = await processTrialReminders();

      expect(result.processed).toBe(0);
      expect(result.sent).toBe(0);
      expect(result.skipped).toBe(0);
      expect(result.results).toEqual([]);
    });

    it("sends notification for Day 4 tenant and marks as sent", async () => {
      const now = Date.now();
      const day4Start = new Date(now - 3 * 24 * 60 * 60 * 1000); // 3 days ago = Day 4

      const mockTenant = {
        id: 1,
        name: "TestFirm",
        trialStartedAt: day4Start,
        trialCredits: 50,
        creditBalance: 30,
      };

      const mockExecute = vi.fn()
        .mockResolvedValueOnce([]) // checkReminderSent returns empty
        .mockResolvedValueOnce([]); // markReminderSent

      const mockDb = {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([mockTenant]),
        execute: mockExecute,
      };

      const { getDb } = await import("./db");
      (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(mockDb);

      const { notifyOwner } = await import("./_core/notification");
      (notifyOwner as ReturnType<typeof vi.fn>).mockResolvedValue(true);

      const { processTrialReminders } = await import("./trialReminders");
      const result = await processTrialReminders();

      expect(result.processed).toBe(1);
      expect(result.sent).toBe(1);
      expect(result.results[0].trialDay).toBe(4);
      expect(result.results[0].sent).toBe(true);
      expect(notifyOwner).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Trial Halfway — TestFirm" })
      );
    });

    it("skips tenant if reminder already sent", async () => {
      const now = Date.now();
      const day4Start = new Date(now - 3 * 24 * 60 * 60 * 1000);

      const mockTenant = {
        id: 1,
        name: "TestFirm",
        trialStartedAt: day4Start,
        trialCredits: 50,
        creditBalance: 30,
      };

      const mockExecute = vi.fn()
        .mockResolvedValueOnce([{ 1: 1 }]); // already sent

      const mockDb = {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([mockTenant]),
        execute: mockExecute,
      };

      const { getDb } = await import("./db");
      (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(mockDb);

      const { processTrialReminders } = await import("./trialReminders");
      const result = await processTrialReminders();

      expect(result.skipped).toBe(1);
      expect(result.sent).toBe(0);
      expect(result.results[0].error).toBe("already_sent");
    });

    it("handles notification service failure gracefully", async () => {
      const now = Date.now();
      const day6Start = new Date(now - 5 * 24 * 60 * 60 * 1000); // 5 days ago = Day 6

      const mockTenant = {
        id: 2,
        name: "FailFirm",
        trialStartedAt: day6Start,
        trialCredits: 50,
        creditBalance: 10,
      };

      const mockExecute = vi.fn()
        .mockResolvedValueOnce([]); // not sent yet

      const mockDb = {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([mockTenant]),
        execute: mockExecute,
      };

      const { getDb } = await import("./db");
      (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(mockDb);

      const { notifyOwner } = await import("./_core/notification");
      (notifyOwner as ReturnType<typeof vi.fn>).mockResolvedValue(false);

      const { processTrialReminders } = await import("./trialReminders");
      const result = await processTrialReminders();

      expect(result.sent).toBe(0);
      expect(result.results[0].error).toBe("notification_service_unavailable");
    });

    it("ignores tenants not on Day 4 or Day 6", async () => {
      const now = Date.now();
      const day2Start = new Date(now - 1 * 24 * 60 * 60 * 1000); // 1 day ago = Day 2

      const mockTenant = {
        id: 3,
        name: "EarlyFirm",
        trialStartedAt: day2Start,
        trialCredits: 50,
        creditBalance: 50,
      };

      const mockDb = {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([mockTenant]),
      };

      const { getDb } = await import("./db");
      (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(mockDb);

      const { processTrialReminders } = await import("./trialReminders");
      const result = await processTrialReminders();

      expect(result.processed).toBe(1);
      expect(result.sent).toBe(0);
      expect(result.skipped).toBe(0);
      expect(result.results).toEqual([]);
    });
  });
});
