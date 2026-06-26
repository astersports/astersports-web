/**
 * Platform audit log — append-only writer + reader for super-admin / platform
 * actions (two-plane redesign §8). Insert-only by construction: there is NO
 * update or delete path here, and callers never mutate an existing row. This is
 * the immutable trail that makes privileged actions (impersonation, org
 * provisioning, and — behind the H1 money-path sign-off — credit issue/revoke)
 * safe to operate.
 *
 * The writer is best-effort and MUST NOT throw into its caller: an audit-write
 * failure must never roll back or block the action it records (we'd rather have
 * the action succeed with a logged audit gap than fail a legitimate super-admin
 * operation). Failures are logged to the server logger, not surfaced.
 */
import { desc, eq, and } from "drizzle-orm";
import { getDb } from "./db";
import { platformAuditLog, type PlatformAuditLogEntry } from "../drizzle/schema";
import { log } from "./serverLog";

/** Stable action keys. varchar in the DB (no enum migration to add a new one). */
export type AuditAction =
  | "org_provisioned"
  | "individual_invited"
  | "impersonation_started"
  | "domain_lock_changed"
  | "org_suspended"
  | "ownership_transferred"
  | "credit_grant"
  | "credit_revoke";

export interface AuditEntryInput {
  actorUserId: number;
  action: AuditAction;
  summary: string;
  targetTenantId?: number | null;
  targetUserId?: number | null;
  metadata?: Record<string, unknown> | null;
}

/**
 * Append one immutable audit row. Best-effort: never throws into the caller — a
 * failed audit write is logged and swallowed so it can't roll back or block the
 * recorded action. Returns true on success, false if the write was skipped/failed.
 */
export async function writeAuditLog(entry: AuditEntryInput): Promise<boolean> {
  try {
    const db = await getDb();
    if (!db) {
      log.warn("platform.audit", "audit write skipped — DB unavailable", {
        metadata: { action: entry.action },
      });
      return false;
    }
    await db.insert(platformAuditLog).values({
      actorUserId: entry.actorUserId,
      action: entry.action,
      summary: entry.summary,
      targetTenantId: entry.targetTenantId ?? null,
      targetUserId: entry.targetUserId ?? null,
      metadata: entry.metadata ?? null,
    });
    return true;
  } catch (err) {
    log.error("platform.audit", "audit write failed", {
      metadata: { action: entry.action, error: (err as Error)?.message },
    });
    return false;
  }
}

export interface AuditLogPage {
  entries: PlatformAuditLogEntry[];
}

/**
 * Read the most recent audit rows for the platform console strip, newest first.
 * Optionally scope to one target org. Read-only.
 */
export async function listAuditLog(opts: { targetTenantId?: number; limit?: number } = {}): Promise<AuditLogPage> {
  const db = await getDb();
  if (!db) return { entries: [] };
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const where = opts.targetTenantId != null
    ? and(eq(platformAuditLog.targetTenantId, opts.targetTenantId))
    : undefined;
  const entries = await db
    .select()
    .from(platformAuditLog)
    .where(where)
    // Stable, deterministic newest-first: createdAt then id as a tie-breaker so
    // same-timestamp rows never reorder (no console flicker; safe for paging).
    .orderBy(desc(platformAuditLog.createdAt), desc(platformAuditLog.id))
    .limit(limit);
  return { entries };
}
