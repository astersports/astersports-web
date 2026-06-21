/**
 * Database helpers for the Print Studio module.
 * Separated from the main db.ts to keep files manageable.
 */
import { eq, and, gte, lte, desc, sql, like } from "drizzle-orm";
import { getDb } from "./db";
import {
  categories,
  tenants,
  memberships,
  creditLedger,
  jobs,
  jobVariations,
  jobFavorites,
  tenantStats,
  users,
  type Tenant,
  type InsertTenant,
  type InsertMembership,
  type InsertJob,
  type InsertJobVariation,
  type InsertCreditLedgerEntry,
} from "../drizzle/schema";
import { TRIAL_DURATION_DAYS } from "../shared/billing";

/**
 * M6: escape LIKE metacharacters in user-supplied search terms so `%`/`_` are
 * matched literally instead of acting as wildcards (LIKE-injection → full scans).
 * `\` is MySQL's default LIKE escape character.
 */
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

// ─── Categories ──────────────────────────────────────────────────────────────

export async function listCategories() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(categories);
}

export async function ensureCategory(name: string, slug: string) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const [existing] = await db.select().from(categories).where(eq(categories.slug, slug)).limit(1);
  if (existing) return existing;
  await db.insert(categories).values({ name, slug });
  const [created] = await db.select().from(categories).where(eq(categories.slug, slug)).limit(1);
  return created!;
}

// ─── Tenants ─────────────────────────────────────────────────────────────────

export async function getTenantById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const [t] = await db.select().from(tenants).where(eq(tenants.id, id)).limit(1);
  return t;
}

export async function getTenantBySlug(slug: string) {
  const db = await getDb();
  if (!db) return undefined;
  const [t] = await db.select().from(tenants).where(eq(tenants.slug, slug)).limit(1);
  return t;
}

export async function createTenant(data: InsertTenant) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.insert(tenants).values(data);
  return getTenantBySlug(data.slug);
}

export async function updateTenantCredits(tenantId: number, newBalance: number) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db
    .update(tenants)
    .set({ creditBalance: newBalance })
    .where(eq(tenants.id, tenantId));
}

export async function updateTenantStripe(
  tenantId: number,
  data: { stripeCustomerId?: string; stripeSubscriptionId?: string; plan?: Tenant["plan"] }
) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.update(tenants).set(data).where(eq(tenants.id, tenantId));
}

// ─── Memberships ─────────────────────────────────────────────────────────────

export async function getMembership(tenantId: number, userId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const [m] = await db
    .select()
    .from(memberships)
    .where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, userId)))
    .limit(1);
  return m;
}

export async function listMemberships(tenantId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(memberships).where(eq(memberships.tenantId, tenantId));
}

export async function getUserTenants(userId: number) {
  const db = await getDb();
  if (!db) return [];
  const mems = await db
    .select()
    .from(memberships)
    .where(and(eq(memberships.userId, userId), eq(memberships.status, "active")));
  if (mems.length === 0) return [];
  const tenantIds = mems.map((m) => m.tenantId);
  const result = await db
    .select()
    .from(tenants)
    .where(sql`${tenants.id} IN (${sql.join(tenantIds.map((id) => sql`${id}`), sql`, `)})`);
  return result.map((t) => ({
    ...t,
    role: mems.find((m) => m.tenantId === t.id)?.role ?? "member",
  }));
}

export async function createMembership(data: InsertMembership) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.insert(memberships).values(data);
}

export async function countActiveMembers(tenantId: number): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const result = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(memberships)
    .where(and(eq(memberships.tenantId, tenantId), eq(memberships.status, "active")));
  return result[0]?.count ?? 0;
}

// ─── Credit Ledger ───────────────────────────────────────────────────────────

export async function addCreditEntry(entry: InsertCreditLedgerEntry) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.insert(creditLedger).values(entry);
}

export async function getCreditHistory(tenantId: number, limit = 50) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(creditLedger)
    .where(eq(creditLedger.tenantId, tenantId))
    .orderBy(desc(creditLedger.createdAt))
    .limit(limit);
}

/**
 * Atomically deduct credits from a tenant. Returns the new balance.
 * Throws if insufficient balance.
 */
export async function deductCredits(
  tenantId: number,
  userId: number,
  amount: number,
  reason: string,
  refId?: string
): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");

  return db.transaction(async (tx) => {
    // Idempotent on (refId, reason), mirroring grantCredits. A retry of the same
    // deduct (e.g. a client re-submitting `job-<id>` after a network timeout, or
    // the tRPC+SSE paths colliding) must not debit twice. If a ledger row already
    // exists for this (refId, reason), return the current balance unchanged. The
    // unique (refId, reason) index is the hard backstop; this check turns a retry
    // into a clean no-op instead of a dup-key error / stuck job.
    if (refId) {
      const [existing] = await tx
        .select({ id: creditLedger.id })
        .from(creditLedger)
        .where(and(eq(creditLedger.refId, refId), eq(creditLedger.reason, reason)))
        .limit(1);
      if (existing) {
        const [t] = await tx.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
        return t?.creditBalance ?? 0;
      }
    }

    // Atomic conditional debit: succeeds only if the balance is still sufficient.
    // The row lock serializes concurrent generates on the same tenant.
    const res = await tx
      .update(tenants)
      .set({ creditBalance: sql`${tenants.creditBalance} - ${amount}` })
      .where(and(eq(tenants.id, tenantId), gte(tenants.creditBalance, amount)));

    const affected = (res as any)?.[0]?.affectedRows ?? 0;
    if (affected === 0) throw new Error("Insufficient credits");

    const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
    const newBalance = tenant!.creditBalance;

    await tx.insert(creditLedger).values({
      tenantId,
      userId,
      delta: -amount,
      balanceAfter: newBalance,
      reason,
      refId,
    });
    return newBalance;
  });
}

/**
 * Grant credits to a tenant (subscription renewal, top-up, admin adjustment).
 */
export async function grantCredits(
  tenantId: number,
  amount: number,
  reason: string,
  refId?: string,
  userId?: number
): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");

  return db.transaction(async (tx) => {
    // C3: idempotent on (refId, reason). Stripe delivers at-least-once and can
    // re-deliver the same economic event under a new event id; a refund path can
    // also fire twice. If a ledger row already exists for this (refId, reason),
    // this grant is a no-op that returns the current balance. The unique index on
    // (refId, reason) is the hard backstop for the concurrent-delivery race.
    // (Reconciliation: #11 proposed (tenantId, refId, reason); we keep
    // (refId, reason) to match the unique index already shipped in #10/0010.)
    if (refId) {
      const [existing] = await tx
        .select({ id: creditLedger.id })
        .from(creditLedger)
        .where(and(eq(creditLedger.refId, refId), eq(creditLedger.reason, reason)))
        .limit(1);
      if (existing) {
        const [t] = await tx.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
        return t?.creditBalance ?? 0;
      }
    }

    const res = await tx
      .update(tenants)
      .set({ creditBalance: sql`${tenants.creditBalance} + ${amount}` })
      .where(eq(tenants.id, tenantId));

    const affected = (res as any)?.[0]?.affectedRows ?? 0;
    if (affected === 0) throw new Error("Tenant not found");

    const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
    const newBalance = tenant!.creditBalance;

    await tx.insert(creditLedger).values({
      tenantId,
      userId: userId ?? null,
      delta: amount,
      balanceAfter: newBalance,
      reason,
      refId,
    });
    return newBalance;
  });
}

// ─── Jobs ────────────────────────────────────────────────────────────────────

export async function createJob(data: InsertJob) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const result = await db.insert(jobs).values(data);
  const insertId = result[0].insertId;
  const [job] = await db.select().from(jobs).where(eq(jobs.id, insertId)).limit(1);
  return job!;
}

export async function updateJobStatus(
  jobId: number,
  status: "pending" | "processing" | "done" | "failed",
  extra?: { instruction?: string; creditsUsed?: number; controls?: string; detectedElements?: string; errorMessage?: string; editType?: string }
) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db
    .update(jobs)
    .set({ status, ...extra })
    .where(eq(jobs.id, jobId));
}

export async function getJob(jobId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const [j] = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
  return j;
}

export async function listTenantJobs(tenantId: number, limit = 50) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(jobs)
    .where(eq(jobs.tenantId, tenantId))
    .orderBy(desc(jobs.createdAt))
    .limit(limit);
}

/**
 * Enhanced history query with search, status filter, pagination,
 * and joined variations (result images).
 */
export async function listTenantJobsEnhanced(
  tenantId: number,
  opts: {
    limit?: number;
    offset?: number;
    status?: string;
    search?: string;
    favoritesOnly?: boolean;
    startDate?: number; // unix ms
    endDate?: number;   // unix ms
    userId?: number;    // filter by creator
    sortBy?: "date" | "credits" | "title";
    sortDir?: "asc" | "desc";
  } = {}
) {
  const db = await getDb();
  if (!db) return { jobs: [], total: 0 };

  const limit = opts.limit ?? 24;
  const offset = opts.offset ?? 0;

  const conditions = [eq(jobs.tenantId, tenantId)];
  if (opts.status && opts.status !== "all") {
    conditions.push(sql`${jobs.status} = ${opts.status}`);
  }
  if (opts.search) {
    const term = `%${escapeLike(opts.search)}%`;
    conditions.push(
      sql`(${jobs.title} LIKE ${term} OR ${jobs.detectedElements} LIKE ${term} OR ${jobs.instruction} LIKE ${term})`
    );
  }
  if (opts.favoritesOnly) {
    conditions.push(
      sql`${jobs.id} IN (SELECT ${jobFavorites.jobId} FROM ${jobFavorites} WHERE ${jobFavorites.tenantId} = ${tenantId})`
    );
  }
  if (opts.startDate) {
    conditions.push(sql`${jobs.createdAt} >= ${new Date(opts.startDate)}`);
  }
  if (opts.endDate) {
    conditions.push(sql`${jobs.createdAt} <= ${new Date(opts.endDate)}`);
  }
  if (opts.userId) {
    conditions.push(eq(jobs.userId, opts.userId));
  }
  const condition = and(...conditions);

  // Determine sort order
  let orderClause;
  const dir = opts.sortDir ?? "desc";
  switch (opts.sortBy) {
    case "credits":
      orderClause = dir === "asc" ? sql`${jobs.creditsUsed} ASC` : sql`${jobs.creditsUsed} DESC`;
      break;
    case "title":
      orderClause = dir === "asc" ? sql`${jobs.title} ASC` : sql`${jobs.title} DESC`;
      break;
    default:
      orderClause = dir === "asc" ? sql`${jobs.createdAt} ASC` : sql`${jobs.createdAt} DESC`;
  }

  const [jobRows, countResult] = await Promise.all([
    db
      .select()
      .from(jobs)
      .where(condition)
      .orderBy(orderClause)
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)` })
      .from(jobs)
      .where(condition),
  ]);

  // Fetch variations for all returned jobs in one query
  const jobIds = jobRows.map((j) => j.id);
  let variationsMap: Record<number, Array<{ id: number; resultUrl: string; round: number; createdAt: Date }>> = {};
  if (jobIds.length > 0) {
    const allVariations = await db
      .select({
        id: jobVariations.id,
        jobId: jobVariations.jobId,
        resultUrl: jobVariations.resultUrl,
        round: jobVariations.round,
        createdAt: jobVariations.createdAt,
      })
      .from(jobVariations)
      // Parameterized IN list (matches getUserTenants) — no raw string interpolation.
      .where(sql`${jobVariations.jobId} IN (${sql.join(jobIds.map((id) => sql`${id}`), sql`, `)})`);
    for (const v of allVariations) {
      if (!variationsMap[v.jobId]) variationsMap[v.jobId] = [];
      variationsMap[v.jobId].push({ id: v.id, resultUrl: v.resultUrl, round: v.round, createdAt: v.createdAt });
    }
  }

  // Fetch user names for attribution
  const userIds = Array.from(new Set(jobRows.map((j) => j.userId)));
  let userMap: Record<number, { name: string | null; email: string | null }> = {};
  if (userIds.length > 0) {
    const userRows = await db
      .select({ id: users.id, name: users.name, email: users.email })
      .from(users)
      .where(sql`${users.id} IN (${sql.raw(userIds.join(","))})`);
    for (const u of userRows) {
      userMap[u.id] = { name: u.name, email: u.email };
    }
  }

  const enrichedJobs = jobRows.map((j) => ({
    ...j,
    variations: variationsMap[j.id] || [],
    userName: userMap[j.userId]?.name || userMap[j.userId]?.email?.split("@")[0] || "Unknown",
  }));

  return { jobs: enrichedJobs, total: countResult[0]?.count ?? 0 };
}

/**
 * Top edit type for the History tile. Prefers the denormalized `editType`
 * column (one bucket per job, no double-count); falls back to the legacy
 * controls-LIKE scan if the column isn't present yet (migration 0012 not
 * applied) — so this is safe to merge ahead of `db:push`.
 */
async function computeTopEditType(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  tenantId: number
): Promise<string> {
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  try {
    const rows = await db
      .select({ editType: jobs.editType, count: sql<number>`count(*)` })
      .from(jobs)
      .where(
        and(
          eq(jobs.tenantId, tenantId),
          sql`${jobs.editType} IS NOT NULL`,
          sql`${jobs.editType} <> 'none'`
        )
      )
      .groupBy(jobs.editType)
      .orderBy(sql`count(*) DESC`)
      .limit(1);
    if (rows.length > 0 && (rows[0].count ?? 0) > 0 && rows[0].editType) {
      return cap(rows[0].editType);
    }
    return "None";
  } catch {
    // Legacy fallback: editType column not present yet (pre-migration). Scan the
    // controls TEXT per single control (combined jobs are not de-duped here).
    const types = ["recolor", "scale", "density", "remove"] as const;
    const counts = await Promise.all(
      types.map(async (t) => {
        const [r] = await db
          .select({ count: sql<number>`count(*)` })
          .from(jobs)
          .where(and(eq(jobs.tenantId, tenantId), sql`${jobs.controls} LIKE ${`%"${t}":%"enabled":true%`}`));
        return { type: cap(t), count: r?.count ?? 0 };
      })
    );
    counts.sort((a, b) => b.count - a.count);
    return counts[0]?.count > 0 ? counts[0].type : "None";
  }
}

/** Single-scan aggregate of a tenant's job stats (total / credits / done). */
async function computeJobAggregates(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  tenantId: number
): Promise<{ totalJobs: number; creditsSpent: number; doneJobs: number }> {
  const [agg] = await db
    .select({
      totalJobs: sql<number>`count(*)`,
      creditsSpent: sql<number>`COALESCE(SUM(${jobs.creditsUsed}), 0)`,
      doneJobs: sql<number>`SUM(CASE WHEN ${jobs.status} = 'done' THEN 1 ELSE 0 END)`,
    })
    .from(jobs)
    .where(eq(jobs.tenantId, tenantId));
  return {
    totalJobs: Number(agg?.totalJobs ?? 0),
    creditsSpent: Number(agg?.creditsSpent ?? 0),
    doneJobs: Number(agg?.doneJobs ?? 0),
  };
}

const TENANT_STATS_FRESH_MS = 5 * 60 * 1000;

/**
 * True only for the MySQL "table doesn't exist" error (errno 1146 /
 * ER_NO_SUCH_TABLE). Lets the rollup reader tolerate `studio_tenant_stats` not
 * being present yet (migration 0013 not applied via db:push) while still
 * surfacing every other DB error instead of silently swallowing it.
 */
function isMissingTableError(err: unknown): boolean {
  const e = err as { code?: string; errno?: number; message?: string } | null;
  return (
    e?.code === "ER_NO_SUCH_TABLE" ||
    e?.errno === 1146 ||
    (typeof e?.message === "string" && /doesn'?t exist|no such table|ER_NO_SUCH_TABLE/i.test(e.message))
  );
}

/**
 * History tile aggregates served from the `studio_tenant_stats` rollup. Returns
 * the cached row when fresh; otherwise recomputes from live data (one scan) and
 * upserts it — O(1) reads within the freshness window, with no cron and no
 * write-path coupling. Recomputed-from-live so it matches a live-scan oracle by
 * construction. Falls back to a pure live aggregate if `studio_tenant_stats`
 * isn't present yet (migration 0013 not applied) — safe to merge ahead of
 * `db:push`.
 */
async function getHistoryAggregates(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  tenantId: number
): Promise<{ totalJobs: number; creditsSpent: number; doneJobs: number }> {
  try {
    const [cached] = await db
      .select({
        totalJobs: tenantStats.totalJobs,
        creditsSpent: tenantStats.creditsSpent,
        doneJobs: tenantStats.doneJobs,
        computedAt: tenantStats.computedAt,
      })
      .from(tenantStats)
      .where(eq(tenantStats.tenantId, tenantId))
      .limit(1);
    if (cached && Date.now() - new Date(cached.computedAt).getTime() < TENANT_STATS_FRESH_MS) {
      return { totalJobs: cached.totalJobs, creditsSpent: cached.creditsSpent, doneJobs: cached.doneJobs };
    }
    const agg = await computeJobAggregates(db, tenantId);
    await db
      .insert(tenantStats)
      .values({ tenantId, ...agg, computedAt: new Date() })
      .onDuplicateKeyUpdate({ set: { ...agg, computedAt: new Date() } });
    return agg;
  } catch (err) {
    // Tolerate the rollup table not being present yet (pre-db:push); surface
    // every other DB error rather than masking it behind a silent live fallback.
    if (!isMissingTableError(err)) throw err;
    return computeJobAggregates(db, tenantId);
  }
}

/**
 * Get summary stats for the History page dashboard cards.
 */
export async function getHistoryStats(tenantId: number) {
  const db = await getDb();
  if (!db) return { totalJobs: 0, creditsSpent: 0, successRate: 0, topType: "none" };

  // Total jobs / credits spent / done jobs — served from the studio_tenant_stats
  // rollup (recompute-on-read when stale); falls back to a live aggregate if the
  // rollup table isn't present yet (migration 0013 not applied).
  const { totalJobs, creditsSpent, doneJobs } = await getHistoryAggregates(db, tenantId);
  const successRate = totalJobs > 0 ? Math.round((doneJobs / totalJobs) * 100) : 0;

  // Top edit type — denormalized `editType` column with a legacy LIKE fallback
  // (safe to merge ahead of `db:push`; see computeTopEditType above).
  const topType = await computeTopEditType(db, tenantId);

  // Members who have generated (for the "Created by" filter)
  const memberRows = await db
    .select({ userId: jobs.userId })
    .from(jobs)
    .where(eq(jobs.tenantId, tenantId))
    .groupBy(jobs.userId);
  const memberIds = memberRows.map((m) => m.userId);
  let members: Array<{ id: number; name: string }> = [];
  if (memberIds.length > 0) {
    const memberUsers = await db
      .select({ id: users.id, name: users.name, email: users.email })
      .from(users)
      .where(sql`${users.id} IN (${sql.raw(memberIds.join(","))})`);
    members = memberUsers.map((u) => ({
      id: u.id,
      name: u.name || u.email?.split("@")[0] || "Unknown",
    }));
  }

  return { totalJobs, creditsSpent, successRate, topType, members };
}

// ─── Job Variations ──────────────────────────────────────────────────────────

export async function addVariation(data: InsertJobVariation) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.insert(jobVariations).values(data);
}

export async function getJobVariations(jobId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(jobVariations)
    .where(eq(jobVariations.jobId, jobId))
    .orderBy(desc(jobVariations.createdAt));
}

/**
 * C1 (generated/* scope): resolve the owning tenant of a prompt-path output by
 * its storage key. The storage proxy uses this to require tenant membership
 * before presigning a `generated/*` key — the same cross-tenant IDOR guard that
 * the `studio/<tenant>/...` regex already provides for originals. A key with no
 * matching variation has no legitimate reader, so the caller fails closed.
 */
export async function getVariationByResultKey(resultKey: string) {
  const db = await getDb();
  if (!db) return undefined;
  const [v] = await db
    .select({ tenantId: jobVariations.tenantId, jobId: jobVariations.jobId })
    .from(jobVariations)
    .where(eq(jobVariations.resultKey, resultKey))
    .limit(1);
  return v;
}

// ─── Credit Ledger ──────────────────────────────────────────────────────────

export async function listCreditLedger(
  tenantId: number,
  opts: { limit?: number; offset?: number; reason?: string; from?: number; to?: number; search?: string; userId?: number } = {}
) {
  const db = await getDb();
  if (!db) return { entries: [], total: 0 };

  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;

  // Build where condition: always filter by tenant, optionally by reason and date range.
  const conditions = [eq(creditLedger.tenantId, tenantId)];
  if (opts.reason) {
    conditions.push(eq(creditLedger.reason, opts.reason));
  }
  if (opts.from) {
    conditions.push(gte(creditLedger.createdAt, new Date(opts.from)));
  }
  if (opts.to) {
    conditions.push(sql`${creditLedger.createdAt} <= ${new Date(opts.to)}`);
  }
  if (opts.search) {
    const searchTerm = `%${escapeLike(opts.search)}%`;
    conditions.push(
      sql`(${creditLedger.refId} LIKE ${searchTerm} OR ${creditLedger.note} LIKE ${searchTerm})`
    );
  }
  if (opts.userId) {
    conditions.push(eq(creditLedger.userId, opts.userId));
  }
  const condition = and(...conditions);

  const [entries, countResult] = await Promise.all([
    db
      .select({
        id: creditLedger.id,
        tenantId: creditLedger.tenantId,
        userId: creditLedger.userId,
        delta: creditLedger.delta,
        balanceAfter: creditLedger.balanceAfter,
        reason: creditLedger.reason,
        refId: creditLedger.refId,
        note: creditLedger.note,
        createdAt: creditLedger.createdAt,
        // Joined metadata from jobs table
        jobInstruction: jobs.instruction,
        jobControls: jobs.controls,
        jobStatus: jobs.status,
        jobTitle: jobs.title,
      })
      .from(creditLedger)
      .leftJoin(
        jobs,
        // M1: tenant-scope the join — without jobs.tenantId = ledger.tenantId a
        // numeric refId collision could surface another tenant's job metadata.
        sql`${creditLedger.refId} IS NOT NULL AND ${jobs.tenantId} = ${creditLedger.tenantId} AND ${jobs.id} = CAST(REPLACE(REPLACE(${creditLedger.refId}, 'job-', ''), '-failed', '') AS UNSIGNED)`
      )
      .where(condition)
      .orderBy(desc(creditLedger.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)` })
      .from(creditLedger)
      .where(condition),
  ]);

  return { entries, total: countResult[0]?.count ?? 0 };
}

// ─── Favorites ──────────────────────────────────────────────────────────────

export async function toggleFavorite(tenantId: number, jobId: number): Promise<boolean> {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");

  // Check if already favorited
  const [existing] = await db
    .select()
    .from(jobFavorites)
    .where(and(eq(jobFavorites.tenantId, tenantId), eq(jobFavorites.jobId, jobId)))
    .limit(1);

  if (existing) {
    await db.delete(jobFavorites).where(eq(jobFavorites.id, existing.id));
    return false; // unfavorited
  } else {
    await db.insert(jobFavorites).values({ tenantId, jobId });
    return true; // favorited
  }
}

export async function getTenantFavoriteJobIds(tenantId: number): Promise<number[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select({ jobId: jobFavorites.jobId })
    .from(jobFavorites)
    .where(eq(jobFavorites.tenantId, tenantId));
  return rows.map((r) => r.jobId);
}

// ─── Trial & Usage Analysis ─────────────────────────────────────────────────

/**
 * Get the trial status for a tenant: days remaining, credits used, whether expired.
 */
export function getTrialStatus(tenant: Tenant) {
  if (!tenant.trialStartedAt) {
    return { inTrial: false, daysRemaining: 0, trialDay: 0, expired: false };
  }

  const now = Date.now();
  const started = new Date(tenant.trialStartedAt).getTime();
  const elapsed = now - started;
  const elapsedDays = Math.floor(elapsed / (1000 * 60 * 60 * 24));
  const trialDay = elapsedDays + 1; // 1-indexed
  const daysRemaining = Math.max(0, TRIAL_DURATION_DAYS - elapsedDays);
  const expired = elapsedDays >= TRIAL_DURATION_DAYS;
  const creditsUsed = tenant.trialCredits - tenant.creditBalance;

  return { inTrial: true, daysRemaining, trialDay, expired, creditsUsed };
}

/**
 * Analyze usage velocity during days 4-7 of the trial to recommend a plan.
 * Returns average daily credit burn and a recommended plan key.
 */
export async function analyzeTrialUsage(tenantId: number, trialStartedAt: Date) {
  const db = await getDb();
  if (!db) return { avgDailyBurn: 0, recommendedPlan: "starter" as const };

  // Days 4-7: from day 3 (0-indexed) to day 7
  const day4Start = new Date(trialStartedAt.getTime() + 3 * 24 * 60 * 60 * 1000);
  const day7End = new Date(trialStartedAt.getTime() + 7 * 24 * 60 * 60 * 1000);
  const now = new Date();
  const endDate = now < day7End ? now : day7End;

  // Sum deductions (negative amounts) during days 4-7
  const [result] = await db
    .select({
      totalSpent: sql<number>`COALESCE(ABS(SUM(CASE WHEN ${creditLedger.delta} < 0 THEN ${creditLedger.delta} ELSE 0 END)), 0)`,
      deductionCount: sql<number>`COUNT(CASE WHEN ${creditLedger.delta} < 0 THEN 1 END)`,
    })
    .from(creditLedger)
    .where(
      and(
        eq(creditLedger.tenantId, tenantId),
        gte(creditLedger.createdAt, day4Start),
        lte(creditLedger.createdAt, endDate)
      )
    );

  const totalSpent = Number(result?.totalSpent ?? 0);
  const daysCovered = Math.max(1, Math.ceil((endDate.getTime() - day4Start.getTime()) / (1000 * 60 * 60 * 24)));
  const avgDailyBurn = totalSpent / daysCovered;

  // Recommendation thresholds:
  // < 50 credits/day (~5 generations) → Starter
  // 50-200 credits/day (5-20 generations) → Pro
  // > 200 credits/day (20+ generations) → Team
  let recommendedPlan: "starter" | "pro" | "team" = "starter";
  if (avgDailyBurn > 200) {
    recommendedPlan = "team";
  } else if (avgDailyBurn > 50) {
    recommendedPlan = "pro";
  }

  return { avgDailyBurn, recommendedPlan, totalSpent, daysCovered, deductionCount: Number(result?.deductionCount ?? 0) };
}
