import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock dependencies before importing
vi.mock("./db", () => ({
  getDb: vi.fn(),
}));

vi.mock("./_core/notification", () => ({
  notifyOwner: vi.fn().mockResolvedValue(true),
}));

vi.mock("../drizzle/schema", () => ({
  serverLogs: { createdAt: "createdAt" },
}));

import { serverLog, log, fireErrorAlert } from "./serverLog";
import { getDb } from "./db";
import { notifyOwner } from "./_core/notification";

describe("serverLog alert hook", () => {
  let mockInsert: ReturnType<typeof vi.fn>;
  let mockValues: ReturnType<typeof vi.fn>;
  let mockExecute: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockExecute = vi.fn().mockResolvedValue(undefined);
    mockValues = vi.fn().mockReturnValue({ execute: mockExecute });
    mockInsert = vi.fn().mockReturnValue({ values: mockValues });
    (getDb as any).mockResolvedValue({ insert: mockInsert });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls notifyOwner when log.error() is invoked", async () => {
    log.error("studio.generate", "SAM2 model returned 404", {
      jobId: 42,
      tenantId: 7,
      metadata: { model: "meta/sam-2" },
    });

    // Allow fire-and-forget promises to resolve
    await new Promise((r) => setTimeout(r, 50));

    expect(notifyOwner).toHaveBeenCalledTimes(1);
    const call = (notifyOwner as any).mock.calls[0][0];
    expect(call.title).toContain("[Studio Error]");
    expect(call.title).toContain("studio.generate");
    expect(call.content).toContain("SAM2 model returned 404");
    expect(call.content).toContain("Job ID: 42");
    expect(call.content).toContain("Tenant ID: 7");
  });

  it("does NOT call notifyOwner for log.info()", async () => {
    log.info("studio.generate", "Generation started", { jobId: 10 });

    await new Promise((r) => setTimeout(r, 50));

    expect(notifyOwner).not.toHaveBeenCalled();
  });

  it("does NOT call notifyOwner for log.warn()", async () => {
    log.warn("studio.density", "Density degraded to prompt path", { tenantId: 3 });

    await new Promise((r) => setTimeout(r, 50));

    expect(notifyOwner).not.toHaveBeenCalled();
  });

  it("does NOT call notifyOwner for log.debug()", async () => {
    log.debug("studio.scale", "Scale factor computed");

    await new Promise((r) => setTimeout(r, 50));

    expect(notifyOwner).not.toHaveBeenCalled();
  });

  it("does not crash if notifyOwner rejects", async () => {
    (notifyOwner as any).mockRejectedValueOnce(new Error("Network timeout"));

    // Should not throw
    log.error("studio.generate", "All variations failed");

    await new Promise((r) => setTimeout(r, 50));

    expect(notifyOwner).toHaveBeenCalledTimes(1);
    // No exception propagated — fire-and-forget
  });

  it("does not crash if notifyOwner throws synchronously", async () => {
    (notifyOwner as any).mockImplementationOnce(() => {
      throw new Error("Sync throw");
    });

    // Should not throw
    log.error("studio.generate", "Unexpected error");

    await new Promise((r) => setTimeout(r, 50));

    // The call was attempted
    expect(notifyOwner).toHaveBeenCalledTimes(1);
  });

  it("includes metadata in notification content", async () => {
    log.error("studio.recolor", "Recolor failed", {
      metadata: { color: "#FF0000", element: "collar" },
      userId: 99,
      durationMs: 4500,
    });

    await new Promise((r) => setTimeout(r, 50));

    const call = (notifyOwner as any).mock.calls[0][0];
    expect(call.content).toContain("User ID: 99");
    expect(call.content).toContain("Duration: 4500ms");
    expect(call.content).toContain('"color":"#FF0000"');
  });

  it("still writes to DB even when notification fails", async () => {
    (notifyOwner as any).mockRejectedValueOnce(new Error("Notification down"));

    log.error("studio.generate", "Generation timeout");

    await new Promise((r) => setTimeout(r, 50));

    // DB write still happened
    expect(mockInsert).toHaveBeenCalled();
  });
});

describe("fireErrorAlert", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("formats title with source and truncated message", async () => {
    await fireErrorAlert({
      level: "error",
      source: "studio.density",
      message: "A".repeat(200), // long message
    });

    const call = (notifyOwner as any).mock.calls[0][0];
    expect(call.title).toContain("[Studio Error] studio.density:");
    // Title message is truncated to 80 chars
    expect(call.title.length).toBeLessThan(200);
  });

  it("omits optional fields when not provided", async () => {
    await fireErrorAlert({
      level: "error",
      source: "test",
      message: "simple error",
    });

    const call = (notifyOwner as any).mock.calls[0][0];
    expect(call.content).not.toContain("Job ID:");
    expect(call.content).not.toContain("Tenant ID:");
    expect(call.content).not.toContain("User ID:");
    expect(call.content).not.toContain("Duration:");
    expect(call.content).not.toContain("Metadata:");
  });
});
