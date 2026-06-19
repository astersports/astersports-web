/**
 * Database helpers for the Print Studio module.
 * Separated from the main db.ts to keep files manageable.
 */
import { eq, and, gte, desc, sql, like } from "drizzle-orm";
import { getDb } from "./db";
import {
  categories,
  tenants,
  memberships,
  creditLedger,
  jobs,
  jobVariations,
  type Tenant,
  type InsertTenant,
  type InsertMembership,
  type InsertJob,
  type InsertJobVariation,
  type InsertCreditLedgerEntry,
} from "../drizzle/schema";

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
  extra?: { instruction?: string; creditsUsed?: number; controls?: string; detectedElements?: string }
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

// ─── Credit Ledger ──────────────────────────────────────────────────────────

export async function listCreditLedger(
  tenantId: number,
  opts: { limit?: number; offset?: number; reason?: string; from?: number; to?: number; search?: string } = {}
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
    const searchTerm = `%${opts.search}%`;
    conditions.push(
      sql`(${creditLedger.refId} LIKE ${searchTerm} OR ${creditLedger.note} LIKE ${searchTerm})`
    );
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
        sql`${creditLedger.refId} IS NOT NULL AND ${jobs.id} = CAST(REPLACE(REPLACE(${creditLedger.refId}, 'job-', ''), '-failed', '') AS UNSIGNED)`
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
