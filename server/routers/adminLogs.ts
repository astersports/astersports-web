/**
 * Admin Logs Router — queryable production logs for debugging.
 * Owner-only access (site admin).
 */
import { z } from "zod";
import { router } from "../_core/trpc";
import { adminProcedure } from "../_core/trpc";
import { getDb } from "../db";
import { serverLogs } from "../../drizzle/schema";
import { desc, eq, and, gte, lte, like, sql, count } from "drizzle-orm";

export const adminLogsRouter = router({
  /** Paginated log query with filters */
  list: adminProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(200).default(50),
        offset: z.number().min(0).default(0),
        level: z.enum(["debug", "info", "warn", "error"]).optional(),
        source: z.string().max(64).optional(),
        jobId: z.number().optional(),
        tenantId: z.number().optional(),
        search: z.string().max(200).optional(),
        from: z.number().optional(), // unix ms
        to: z.number().optional(),   // unix ms
      }).default({ limit: 50, offset: 0 })
    )
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { logs: [], total: 0 };

      const conditions = [];
      if (input.level) conditions.push(eq(serverLogs.level, input.level));
      if (input.source) conditions.push(eq(serverLogs.source, input.source));
      if (input.jobId) conditions.push(eq(serverLogs.jobId, input.jobId));
      if (input.tenantId) conditions.push(eq(serverLogs.tenantId, input.tenantId));
      if (input.search) {
        // M6: escape LIKE metacharacters so a user-supplied `%`/`_` can't turn the
        // search into a wildcard scan. `\` is the default MySQL LIKE escape char.
        const escaped = input.search.replace(/[\\%_]/g, (ch) => `\\${ch}`);
        conditions.push(like(serverLogs.message, `%${escaped}%`));
      }
      if (input.from) conditions.push(gte(serverLogs.createdAt, new Date(input.from)));
      if (input.to) conditions.push(lte(serverLogs.createdAt, new Date(input.to)));

      const where = conditions.length > 0 ? and(...conditions) : undefined;

      const [logs, totalResult] = await Promise.all([
        db
          .select()
          .from(serverLogs)
          .where(where)
          .orderBy(desc(serverLogs.createdAt))
          .limit(input.limit)
          .offset(input.offset),
        db
          .select({ count: count() })
          .from(serverLogs)
          .where(where),
      ]);

      return {
        logs,
        total: totalResult[0]?.count ?? 0,
      };
    }),

  /** Get distinct sources for filter dropdown */
  sources: adminProcedure.query(async () => {
    const db = await getDb();
    if (!db) return [];
    const result = await db
      .selectDistinct({ source: serverLogs.source })
      .from(serverLogs)
      .orderBy(serverLogs.source);
    return result.map((r) => r.source);
  }),

  /** Summary stats for the dashboard */
  stats: adminProcedure
    .input(
      z.object({
        hours: z.number().min(1).max(720).default(24),
      }).default({ hours: 24 })
    )
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { total: 0, errors: 0, warnings: 0, bySource: [] };

      const since = new Date(Date.now() - input.hours * 60 * 60 * 1000);
      const sinceCondition = gte(serverLogs.createdAt, since);

      const [totalResult, errorResult, warnResult, bySourceResult] = await Promise.all([
        db.select({ count: count() }).from(serverLogs).where(sinceCondition),
        db.select({ count: count() }).from(serverLogs).where(and(sinceCondition, eq(serverLogs.level, "error"))),
        db.select({ count: count() }).from(serverLogs).where(and(sinceCondition, eq(serverLogs.level, "warn"))),
        db
          .select({ source: serverLogs.source, count: count() })
          .from(serverLogs)
          .where(sinceCondition)
          .groupBy(serverLogs.source)
          .orderBy(desc(sql`count(*)`)),
      ]);

      return {
        total: totalResult[0]?.count ?? 0,
        errors: errorResult[0]?.count ?? 0,
        warnings: warnResult[0]?.count ?? 0,
        bySource: bySourceResult,
      };
    }),
});
