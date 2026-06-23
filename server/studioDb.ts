/**
 * Database helpers for the Print Studio module.
 * Separated from the main db.ts to keep files manageable.
 */
import { eq, and, gte, lte, desc, sql, like, inArray } from "drizzle-orm";
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
  type PredictionMeta,
} from "../drizzle/schema";
import { TRIAL_DURATION_DAYS } from "../shared/billing";
import { encodeCursor, decodeCursor } from "./cursor";

/**
 * M6: escape LIKE metacharacters in user-supplied search terms so `%`/`_` are
 * matched literally instead of acting as wildcards (LIKE-injection → full scans).
 * `\` is MySQL's default LIKE escape character.
 */
export function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/**
 * M5d: FULLTEXT search capability. The `ft_studio_jobs_search` index is applied
 * out-of-band (custom migration 0015) via db:push; until then History search
 * falls back to substring LIKE. A definitive probe result is cached once per
 * process (the index can't appear mid-process — it lands on a deploy/restart
 * after db:push). A transient probe FAILURE is NOT cached, so a connection blip
 * during the first probe doesn't pin LIKE for the process lifetime.
 */
let jobsFulltextAvailable: boolean | null = null;
async function hasJobsFulltextIndex(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>
): Promise<boolean> {
  if (jobsFulltextAvailable !== null) return jobsFulltextAvailable;
  try {
    const res = await db.execute(sql`
      SELECT 1 AS present FROM information_schema.statistics
      WHERE table_schema = DATABASE()
        AND table_name = 'studio_jobs'
        AND index_type = 'FULLTEXT'
      LIMIT 1
    `);
    const rows = (Array.isArray(res) ? res[0] : (res as { rows?: unknown[] })?.rows) ?? [];
    jobsFulltextAvailable = Array.isArray(rows) && rows.length > 0;
    return jobsFulltextAvailable;
  } catch {
    // Transient failure — leave the cache unset so a later call re-probes;
    // use LIKE for this request only.
    return false;
  }
}

/** Minimum token length InnoDB FULLTEXT indexes by default (innodb_ft_min_token_size). */
const FT_MIN_TOKEN = 3;

/**
 * M5d: build a BOOLEAN-mode FULLTEXT query from raw user input. Tokenizes on
 * separators, requires each token as a prefix match (`+tok*`), and drops every
 * FULLTEXT boolean operator so user input can't inject syntax. Returns null
 * when the query isn't FULLTEXT-suitable (no tokens, or any token shorter than
 * the min indexed length) — the caller then uses the LIKE path so
 * short/punctuation-only queries still match by substring.
 */
export function toJobsBooleanQuery(search: string): string | null {
  // Split on whitespace + all ASCII punctuation/operators (ranges 33-47, 58-64,
  // 91-96, 123-126). Implemented as a separator replace rather than a `\p{L}`
  // Unicode class with the `u` flag: tsconfig.json sets `lib` but no `target`,
  // so tsc defaults below es6 and rejects the `u` flag at compile time (TS1501).
  // ASCII letters/digits and any non-ASCII letters (accents) survive, while
  // every FULLTEXT boolean operator (+ - > < ( ) ~ * " @ …) is stripped,
  // preventing the user from injecting boolean-mode syntax.
  const tokens = search
    .replace(/[\s!-/:-@[-`{-~]+/g, " ")
    .split(" ")
    .filter(Boolean);
  if (tokens.length === 0) return null;
  if (tokens.some((t) => t.length < FT_MIN_TOKEN)) return null;
  return tokens.map((t) => `+${t}*`).join(" ");
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

/**
 * Count the tenants a user OWNS (role='owner' membership). Backs the self-serve
 * `tenants.create` lifetime rate cap. Counts every owner membership regardless of
 * how the org was provisioned (self-serve, invite-redeem, admin) — the
 * conservative bound: each owned org seeds trial credits, so this caps a user's
 * total trial-credit minting without needing a "created-via-self-serve" marker.
 */
export async function countUserOwnedTenants(userId: number): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const result = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(memberships)
    .where(and(eq(memberships.userId, userId), eq(memberships.role, "owner")));
  return result[0]?.count ?? 0;
}

/** Count the tenants a user has come to OWN since `since` — the self-serve
 *  `tenants.create` burst cap (membership.createdAt ≈ org-creation time). */
export async function countUserOwnedTenantsSince(userId: number, since: Date): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const result = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(memberships)
    .where(and(
      eq(memberships.userId, userId),
      eq(memberships.role, "owner"),
      gte(memberships.createdAt, since),
    ));
  return result[0]?.count ?? 0;
}

/**
 * Best-effort teardown of a just-created tenant whose downstream provisioning
 * (owner membership / trial grant) failed, so a self-serve `tenants.create` error
 * never strands a half-provisioned org. Deletes children (memberships, any ledger
 * rows) before the tenant to satisfy FK order. Callers wrap this in try/catch and
 * log — cleanup failure must not mask the original provisioning error.
 */
export async function deleteTenantCascade(tenantId: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.delete(memberships).where(eq(memberships.tenantId, tenantId));
  await db.delete(creditLedger).where(eq(creditLedger.tenantId, tenantId));
  await db.delete(tenants).where(eq(tenants.id, tenantId));
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
 * Count prior generation deduct attempts for a job — ledger rows with
 * reason='generation' and a refId of `job-<id>-a*`. The SSE endpoint uses this to
 * mint a UNIQUE per-attempt deduct refId, so a regenerate on the same jobId
 * actually charges (a fixed `job-<id>` refId becomes an idempotent no-op → free
 * generation) and a refund only ever offsets the attempt that debited.
 */
export async function countJobGenerationAttempts(jobId: number): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const rows = await db
    .select({ id: creditLedger.id })
    .from(creditLedger)
    .where(and(eq(creditLedger.reason, "generation"), like(creditLedger.refId, `job-${jobId}-a%`)));
  return rows.length;
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
  status: "pending" | "processing" | "sam2_processing" | "cpu_processing" | "done" | "failed",
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

/** Find a job by its Replicate prediction id (async worker — webhook lookup). */
export async function getJobByPredictionId(predictionId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const [j] = await db.select().from(jobs).where(eq(jobs.predictionId, predictionId)).limit(1);
  return j;
}

/** Atomically claim a job for the CPU op phase: sam2_processing -> cpu_processing. Returns true
 *  ONLY for the worker that won the transition, so concurrent webhook + cron ticks can't both run
 *  the op / write a duplicate variation (ASYNC_GENERATION_SPEC §4 concurrency). */
export async function claimJobForCpuProcessing(jobId: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  // Use inArray() for the status enum predicate, mirroring listSam2ProcessingJobs /
  // reapStuckJobs: Drizzle eq() on a MySQL enum can silently match zero rows in
  // serverless containers (TiDB + Autoscale), which here would make every claim
  // return affectedRows=0 and strand async jobs in sam2_processing. The id predicate
  // stays eq() (int PK, unaffected); correctness still comes from affectedRows.
  const res = await db
    .update(jobs)
    .set({ status: "cpu_processing" })
    .where(and(eq(jobs.id, jobId), inArray(jobs.status, ["sam2_processing"])));
  return ((res as any)?.[0]?.affectedRows ?? 0) > 0;
}

/** Jobs awaiting their SAM2 prediction (cron poller). Bounded by `limit` (N=1 in prod to clear
 *  the Manus 60s execution cap). Oldest first so no job starves.
 *
 *  Uses inArray() instead of eq() to work around a confirmed issue where
 *  Drizzle's eq() on MySQL enums silently returns empty results in serverless
 *  containers (TiDB + Autoscale). The reaper uses inArray() which works reliably,
 *  so we mirror that pattern here. */
export async function listSam2ProcessingJobs(limit: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(jobs)
    .where(inArray(jobs.status, ["sam2_processing"]))
    .orderBy(jobs.enqueuedAt)
    .limit(limit);
}

/** Async enqueue (ASYNC_GENERATION_SPEC §4): stamp the started prediction + crop geometry onto the
 *  job and move it to sam2_processing so the worker/cron can pick it up. */
export async function markJobEnqueued(
  jobId: number,
  predictionId: string,
  predictionMeta: PredictionMeta,
  creditsUsed: number,
  controls: string
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db
    .update(jobs)
    .set({ status: "sam2_processing", predictionId, predictionMeta, enqueuedAt: new Date(), creditsUsed, controls })
    .where(eq(jobs.id, jobId));
}

/**
 * Reap jobs stuck in "processing" past a deadline: idempotently refund (only if
 * no refund already exists for the job) and mark them failed. Backstops strands
 * where neither the SSE in-process refund (180s timer / req-close) nor the rerun
 * catch ran — e.g. an infra hard-kill of the container or a detached promise
 * dying on serverless. `olderThanMs` MUST exceed the max in-process duration
 * (the generation budget) so this can never race a still-running job.
 *
 * Idempotency: every in-process refund refId starts `job-<id>-` (rerun:
 * `job-<id>-failed`; SSE: `job-<id>-a<n>-failed`). The reaper only refunds when
 * no `refund` row matches `job-<id>-%`, then writes `job-<id>-reaped` — so it
 * can neither double-refund a job an in-process catch already handled nor
 * re-refund on a second sweep (grantCredits is itself idempotent on the key).
 */
export async function reapStuckJobs(
  olderThanMs: number,
  limit = 500
): Promise<{ reaped: number; refunded: number }> {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const cutoff = new Date(Date.now() - olderThanMs);

  const stuck = await db
    .select({ id: jobs.id, tenantId: jobs.tenantId, creditsUsed: jobs.creditsUsed })
    .from(jobs)
    .where(and(inArray(jobs.status, ["processing", "sam2_processing", "cpu_processing"]), lte(jobs.updatedAt, cutoff)))
    .limit(limit);

  let reaped = 0;
  let refunded = 0;
  for (const job of stuck) {
    const cost = job.creditsUsed ?? 0;
    if (cost > 0) {
      const [already] = await db
        .select({ id: creditLedger.id })
        .from(creditLedger)
        .where(and(eq(creditLedger.reason, "refund"), like(creditLedger.refId, `job-${job.id}-%`)))
        .limit(1);
      if (!already) {
        await grantCredits(job.tenantId, cost, "refund", `job-${job.id}-reaped`);
        refunded++;
      }
    }
    await updateJobStatus(job.id, "failed", {
      errorMessage: "Timed out — automatically failed and refunded.",
    }).catch(() => {});
    reaped++;
  }
  return { reaped, refunded };
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
    cursor?: string;    // M5c: keyset cursor (load-more); takes precedence over offset
    status?: string;
    search?: string;
    favoritesOnly?: boolean;
    startDate?: number; // unix ms
    endDate?: number;   // unix ms
    userId?: number;    // filter by creator
    sortBy?: "date" | "credits" | "title";
    sortDir?: "asc" | "desc";
    editType?: string;  // filter by denormalized edit type (M5a)
  } = {}
) {
  const db = await getDb();
  if (!db) return { jobs: [], total: 0, nextCursor: null };

  const limit = opts.limit ?? 24;
  const offset = opts.offset ?? 0;

  const conditions = [eq(jobs.tenantId, tenantId)];
  if (opts.status && opts.status !== "all") {
    conditions.push(sql`${jobs.status} = ${opts.status}`);
  }
  if (opts.search) {
    // M5d: FULLTEXT MATCH when the query is FULLTEXT-suitable AND the
    // ft_studio_jobs_search index is present; substring LIKE otherwise
    // (pre-migration, or short/punctuation-only queries the index can't serve).
    // Tokenize first so non-suitable queries skip the information_schema probe.
    const boolQuery = toJobsBooleanQuery(opts.search);
    if (boolQuery && (await hasJobsFulltextIndex(db))) {
      conditions.push(
        sql`MATCH(${jobs.title}, ${jobs.detectedElements}, ${jobs.instruction}) AGAINST(${boolQuery} IN BOOLEAN MODE)`
      );
    } else {
      const term = `%${escapeLike(opts.search)}%`;
      conditions.push(
        sql`(${jobs.title} LIKE ${term} OR ${jobs.detectedElements} LIKE ${term} OR ${jobs.instruction} LIKE ${term})`
      );
    }
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
  if (opts.editType) {
    conditions.push(eq(jobs.editType, opts.editType));
  }
  const condition = and(...conditions);

  // M5c: order by the chosen column with the PK as a tiebreaker, so the order is
  // total and keyset cursors stay stable across rows with equal sort keys.
  // creditsUsed is nullable — coalesce so ordering/keyset stay stable across NULLs.
  const sortBy = opts.sortBy ?? "date";
  const dir = opts.sortDir ?? "desc";
  const sortCol =
    sortBy === "credits"
      ? sql`COALESCE(${jobs.creditsUsed}, 0)`
      : sortBy === "title"
      ? jobs.title
      : jobs.createdAt;
  const dirKw = dir === "asc" ? sql`asc` : sql`desc`;
  const orderClause = sql`${sortCol} ${dirKw}, ${jobs.id} ${dirKw}`;

  // M5c keyset predicate (load-more): rows strictly past the cursor in sort
  // order. Ignore a cursor whose key type doesn't match the active sort (stale,
  // cross-sort, or tampered) so we degrade to the first page instead of coercing
  // it into NaN dates / bad comparisons. Built separately from `condition` so the
  // total count ignores the cursor; a cursor pins offset to 0.
  const expectKey = sortBy === "title" ? "string" : "number";
  const rawDecoded = opts.cursor ? decodeCursor(opts.cursor) : null;
  const decoded = rawDecoded && typeof rawDecoded.k === expectKey ? rawDecoded : null;
  let rowCondition = condition;
  if (decoded) {
    const kVal = sortBy === "date" ? new Date(Number(decoded.k)) : decoded.k;
    const keyset =
      dir === "asc"
        ? sql`(${sortCol} > ${kVal} OR (${sortCol} = ${kVal} AND ${jobs.id} > ${decoded.id}))`
        : sql`(${sortCol} < ${kVal} OR (${sortCol} = ${kVal} AND ${jobs.id} < ${decoded.id}))`;
    rowCondition = and(condition, keyset);
  }
  const effectiveOffset = decoded ? 0 : offset;

  const [jobRows, countResult] = await Promise.all([
    db
      .select()
      .from(jobs)
      .where(rowCondition)
      .orderBy(orderClause)
      .limit(limit)
      .offset(effectiveOffset),
    db
      .select({ count: sql<number>`count(*)` })
      .from(jobs)
      .where(condition),
  ]);

  // M5c: nextCursor when a full page came back (more may remain) — encodes the
  // last row's sort-key value + id for the following keyset page.
  const lastJob = jobRows[jobRows.length - 1];
  const nextCursor =
    jobRows.length === limit && lastJob
      ? encodeCursor(
          sortBy === "credits"
            ? lastJob.creditsUsed ?? 0
            : sortBy === "title"
            ? lastJob.title
            : lastJob.createdAt.getTime(),
          lastJob.id
        )
      : null;

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

  return { jobs: enrichedJobs, total: countResult[0]?.count ?? 0, nextCursor };
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
  opts: { limit?: number; offset?: number; cursor?: string; reason?: string; from?: number; to?: number; search?: string; userId?: number } = {}
) {
  const db = await getDb();
  if (!db) return { entries: [], total: 0, nextCursor: null };

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

  // M5c keyset (load-more): rows past the cursor in (createdAt, id) DESC order.
  // Separate from `condition` so the total count ignores the cursor; a cursor
  // pins offset to 0 (cursor and offset are mutually exclusive). Ignore a cursor
  // whose key isn't a numeric epoch-ms (stale/tampered) so we degrade to the
  // first page instead of new Date(NaN) / confusing empty pages.
  const rawDecoded = opts.cursor ? decodeCursor(opts.cursor) : null;
  const decoded = rawDecoded && typeof rawDecoded.k === "number" ? rawDecoded : null;
  let rowCondition = condition;
  if (decoded) {
    const kVal = new Date(decoded.k);
    rowCondition = and(
      condition,
      sql`(${creditLedger.createdAt} < ${kVal} OR (${creditLedger.createdAt} = ${kVal} AND ${creditLedger.id} < ${decoded.id}))`
    );
  }
  const effectiveOffset = decoded ? 0 : offset;

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
      .where(rowCondition)
      .orderBy(desc(creditLedger.createdAt), desc(creditLedger.id))
      .limit(limit)
      .offset(effectiveOffset),
    db
      .select({ count: sql<number>`count(*)` })
      .from(creditLedger)
      .where(condition),
  ]);

  // M5c: nextCursor when a full page came back — (createdAt ms, id) of the last
  // entry for the following keyset page.
  const lastEntry = entries[entries.length - 1];
  const nextCursor =
    entries.length === limit && lastEntry
      ? encodeCursor(lastEntry.createdAt.getTime(), lastEntry.id)
      : null;

  return { entries, total: countResult[0]?.count ?? 0, nextCursor };
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
