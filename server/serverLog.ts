/**
 * Structured production logger.
 * Writes to the server_logs table for queryable, filterable debugging.
 * Fire-and-forget by default (does not await DB write to avoid slowing hot paths).
 */
import { getDb } from "./db";
import { serverLogs } from "../drizzle/schema";

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

  // Fire-and-forget — don't block the request
  getDb().then((db) => {
    if (!db) return;
    return db.insert(serverLogs).values(row).execute();
  }).catch((err: Error) => {
    console.error("[serverLog] Failed to write log:", err.message, row);
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
