/**
 * Structured production logger.
 * Writes to the server_logs table for queryable, filterable debugging.
 * Fire-and-forget by default (does not await DB write to avoid slowing hot paths).
 *
 * Error-level entries also trigger an owner notification via notifyOwner()
 * so production failures surface immediately without manual log checking.
 */
import { getDb } from "./db";
import { serverLogs } from "../drizzle/schema";
import { notifyOwner } from "./_core/notification";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  level: LogLevel;
  source: string;
  message: string;
  metadata?: Record<string, unknown>;
  jobId?: number;
  tenantId?: number;
  userId?: number;
  durationMs?: number;
}

/**
 * Write a structured log entry to the database.
 * Non-blocking by default — errors are caught and printed to stderr.
 *
 * For error-level entries, also fires a notifyOwner() alert asynchronously.
 */
export function serverLog(entry: LogEntry): void {
  const row = {
    level: entry.level,
    source: entry.source.slice(0, 64),
    message: entry.message.slice(0, 1024),
    metadata: entry.metadata ?? null,
    jobId: entry.jobId ?? null,
    tenantId: entry.tenantId ?? null,
    userId: entry.userId ?? null,
    durationMs: entry.durationMs ?? null,
  };

  // Fire-and-forget DB write — don't block the request
  getDb().then((db) => {
    if (!db) return;
    return db.insert(serverLogs).values(row).execute();
  }).catch((err: Error) => {
    console.error("[serverLog] Failed to write log:", err.message, row);
  });

  // Alert hook: notify owner on error-level entries (fire-and-forget)
  if (entry.level === "error") {
    fireErrorAlert(entry).catch(() => {
      // Swallow — notification failure must never crash the logger
    });
  }
}

/**
 * Fire an owner notification for an error-level log entry.
 * Includes source, message, jobId, and tenantId for quick triage context.
 */
async function fireErrorAlert(entry: LogEntry): Promise<void> {
  const lines: string[] = [
    `Source: ${entry.source}`,
    `Message: ${entry.message}`,
  ];
  if (entry.jobId != null) lines.push(`Job ID: ${entry.jobId}`);
  if (entry.tenantId != null) lines.push(`Tenant ID: ${entry.tenantId}`);
  if (entry.userId != null) lines.push(`User ID: ${entry.userId}`);
  if (entry.durationMs != null) lines.push(`Duration: ${entry.durationMs}ms`);
  if (entry.metadata) {
    try {
      lines.push(`Metadata: ${JSON.stringify(entry.metadata).slice(0, 500)}`);
    } catch {
      // ignore serialization errors
    }
  }

  await notifyOwner({
    title: `[Studio Error] ${entry.source}: ${entry.message.slice(0, 80)}`,
    content: lines.join("\n"),
  });
}

/**
 * Awaitable version for critical paths where you need confirmation the log was written.
 */
export async function serverLogSync(entry: LogEntry): Promise<void> {
  const row = {
    level: entry.level,
    source: entry.source.slice(0, 64),
    message: entry.message.slice(0, 1024),
    metadata: entry.metadata ?? null,
    jobId: entry.jobId ?? null,
    tenantId: entry.tenantId ?? null,
    userId: entry.userId ?? null,
    durationMs: entry.durationMs ?? null,
  };

  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(serverLogs).values(row).execute();

  // Also fire alert for error-level (non-blocking even in sync path)
  if (entry.level === "error") {
    fireErrorAlert(entry).catch(() => {});
  }
}

/** Convenience helpers */
export const log = {
  debug: (source: string, message: string, opts?: Omit<LogEntry, "level" | "source" | "message">) =>
    serverLog({ level: "debug", source, message, ...opts }),
  info: (source: string, message: string, opts?: Omit<LogEntry, "level" | "source" | "message">) =>
    serverLog({ level: "info", source, message, ...opts }),
  warn: (source: string, message: string, opts?: Omit<LogEntry, "level" | "source" | "message">) =>
    serverLog({ level: "warn", source, message, ...opts }),
  error: (source: string, message: string, opts?: Omit<LogEntry, "level" | "source" | "message">) =>
    serverLog({ level: "error", source, message, ...opts }),
};

// Export for testing
export { fireErrorAlert };
