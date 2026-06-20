/**
 * Log Retention Cleanup
 *
 * Deletes server_logs entries older than 30 days.
 * Designed to be called from a Heartbeat cron job at /api/scheduled/log-cleanup.
 * Also exported for direct invocation in tests.
 */
import { getDb } from "./db";
import { serverLogs } from "../drizzle/schema";
import { lt } from "drizzle-orm";

/** Retention period in milliseconds (30 days) */
export const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Delete all server_logs rows older than the retention period.
 * Returns the number of rows deleted, or -1 if DB is unavailable.
 */
export async function pruneOldLogs(): Promise<number> {
  const db = await getDb();
  if (!db) {
    console.warn("[logRetention] Database not available, skipping cleanup");
    return -1;
  }

  const cutoff = new Date(Date.now() - RETENTION_MS);

  const result = await db
    .delete(serverLogs)
    .where(lt(serverLogs.createdAt, cutoff));

  // drizzle mysql delete returns [ResultSetHeader, ...]
  // ResultSetHeader has affectedRows
  const affectedRows = (result as any)?.[0]?.affectedRows ?? 0;
  return affectedRows;
}
