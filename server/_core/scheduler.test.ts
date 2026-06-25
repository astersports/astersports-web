import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockEnv = vi.hoisted(() => ({ schedulerEnabled: true, cronSecret: "sek" }));
vi.mock("./env", () => ({ ENV: mockEnv }));

import { startScheduler, stopScheduler, SCHEDULED_JOBS } from "./scheduler";

describe("in-process scheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockEnv.schedulerEnabled = true;
    mockEnv.cronSecret = "sek";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
  });
  afterEach(() => {
    stopScheduler();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("does nothing when ENABLE_SCHEDULER is off", () => {
    mockEnv.schedulerEnabled = false;
    startScheduler(3000);
    vi.advanceTimersByTime(10 * 60_000);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("refuses to start without CRON_SECRET (endpoints would be unprotected)", () => {
    mockEnv.cronSecret = "";
    startScheduler(3000);
    vi.advanceTimersByTime(10 * 60_000);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("triggers poll-predictions every minute via localhost self-HTTP with the cron secret", async () => {
    startScheduler(3000);
    await vi.advanceTimersByTimeAsync(60_000);

    const calls = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls;
    const poll = calls.find((c: unknown[]) => String(c[0]).endsWith("/api/scheduled/poll-predictions"));
    expect(poll).toBeTruthy();
    expect(poll![0]).toBe("http://127.0.0.1:3000/api/scheduled/poll-predictions");
    expect((poll![1] as RequestInit).method).toBe("POST");
    expect((poll![1] as { headers: Record<string, string> }).headers["x-cron-secret"]).toBe("sek");
  });

  it("covers the studio + billing + maintenance jobs", () => {
    expect(SCHEDULED_JOBS.map((j) => j.name)).toEqual(
      expect.arrayContaining([
        "poll-predictions",
        "reap-stuck-jobs",
        "game-check",
        "log-cleanup",
        "trial-reminders",
        "trial-autocharge",
      ])
    );
  });
});
