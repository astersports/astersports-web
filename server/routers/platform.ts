/**
 * Platform Console router — super_admin only.
 * Provides account listing, provisioning, credit granting, and impersonation.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq, sql, and, like, desc, inArray, gte } from "drizzle-orm";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { tenants, memberships, platformAdmins, users, creditLedger } from "../../drizzle/schema";
import { grantCredits, createTenant, createMembership, escapeLike } from "../studioDb";
import { TRIAL_DURATION_DAYS } from "../../shared/billing";
import { signImpersonationToken, setImpersonationCookie, clearImpersonationCookie, getImpersonationFromRequest } from "../impersonation";

// ─── Super Admin Middleware ──────────────────────────────────────────────────

const superAdminProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

  const [admin] = await db
    .select()
    .from(platformAdmins)
    .where(eq(platformAdmins.userId, ctx.user.id))
    .limit(1);

  if (!admin) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Platform admin access required" });
  }

  return next({ ctx: { ...ctx, isSuperAdmin: true } });
});

// ─── Router ──────────────────────────────────────────────────────────────────

export const platformRouter = router({
  /**
   * List accounts (firm/individual), optionally filtered by type and a name
   * search, with a total count and a growing-limit "load more" page. Scales to
   * many orgs + individuals: enrichment (member counts + owner email) is done in
   * 3 queries total (tenants page → memberships via inArray → owner users via
   * inArray), not the previous per-account N+1.
   */
  listAccounts: superAdminProcedure
    .input(
      z.object({
        type: z.enum(["firm", "individual", "all"]).default("all"),
        search: z.string().max(100).optional(),
        limit: z.number().min(1).max(200).default(30),
      })
    )
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { accounts: [], total: 0 };

      const conds = [];
      if (input.type !== "all") conds.push(eq(tenants.type, input.type));
      if (input.search) conds.push(like(tenants.name, `%${escapeLike(input.search)}%`));
      const where = conds.length ? and(...conds) : undefined;

      const [countRow] = await db
        .select({ count: sql<number>`count(*)` })
        .from(tenants)
        .where(where);
      const total = Number(countRow?.count ?? 0);

      const pageRows = await db
        .select()
        .from(tenants)
        .where(where)
        .orderBy(desc(tenants.id))
        .limit(input.limit);

      if (pageRows.length === 0) return { accounts: [], total };

      // Batch-enrich: one memberships query for the whole page, one users query
      // for the distinct owners — no per-account round-trips.
      const tenantIds = pageRows.map((t) => t.id);
      const mems = await db
        .select()
        .from(memberships)
        .where(inArray(memberships.tenantId, tenantIds));

      const ownerIds = Array.from(
        new Set(mems.filter((m) => m.role === "owner").map((m) => m.userId))
      );
      const ownerRows = ownerIds.length
        ? await db
            .select({ id: users.id, email: users.email, name: users.name })
            .from(users)
            .where(inArray(users.id, ownerIds))
        : [];
      const ownerMap = new Map(ownerRows.map((u) => [u.id, u]));

      const accounts = pageRows.map((account) => {
        const tMems = mems.filter((m) => m.tenantId === account.id);
        const ownerMem = tMems.find((m) => m.role === "owner");
        return {
          ...account,
          activeMembers: tMems.filter((m) => m.status === "active").length,
          ownerEmail: ownerMem ? ownerMap.get(ownerMem.userId)?.email ?? null : null,
        };
      });

      return { accounts, total };
    }),

  /**
   * Cross-org rollup for the platform dashboard: account mix, credits
   * outstanding, trial pipeline, and the 7-day top spenders across ALL tenants.
   * A handful of aggregate queries (no per-account fan-out), so it scales.
   */
  stats: superAdminProcedure.query(async () => {
    // superAdminProcedure middleware already throws if DB is unavailable,
    // so getDb() here is guaranteed non-null.
    const db = (await getDb())!;

    // One pass over the tenant rows for the mix / credits / trial pipeline.
    const allTenants = await db
      .select({
        type: tenants.type,
        plan: tenants.plan,
        creditBalance: tenants.creditBalance,
        trialStartedAt: tenants.trialStartedAt,
        trialConvertedAt: tenants.trialConvertedAt,
      })
      .from(tenants);

    const now = Date.now();
    const TRIAL_MS = TRIAL_DURATION_DAYS * 24 * 60 * 60 * 1000;
    const EXPIRING_MS = 3 * 24 * 60 * 60 * 1000; // "soon" = within 3 days
    let firmCount = 0, individualCount = 0, totalCreditsOutstanding = 0;
    let paidCount = 0, inTrialCount = 0, trialsExpiringSoon = 0;
    for (const t of allTenants) {
      if (t.type === "firm") firmCount++; else individualCount++;
      totalCreditsOutstanding += t.creditBalance;
      if (t.plan !== "none") paidCount++;
      if (t.trialStartedAt && !t.trialConvertedAt) {
        const end = new Date(t.trialStartedAt).getTime() + TRIAL_MS;
        if (now < end) {
          inTrialCount++;
          if (end - now <= EXPIRING_MS) trialsExpiringSoon++;
        }
      }
    }

    // 7-day spend per tenant → total + top 5. Number()-coerce the SQL SUM
    // (mysql2 returns aggregates as strings — see firmAdmin spend fix).
    const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);
    const spendRows = await db
      .select({
        tenantId: creditLedger.tenantId,
        spent: sql<number>`ABS(SUM(CASE WHEN ${creditLedger.delta} < 0 THEN ${creditLedger.delta} ELSE 0 END))`,
      })
      .from(creditLedger)
      .where(gte(creditLedger.createdAt, sevenDaysAgo))
      .groupBy(creditLedger.tenantId);

    const spend = spendRows
      .map((r) => ({ tenantId: r.tenantId, spent: Number(r.spent ?? 0) }))
      .filter((s) => s.spent > 0)
      .sort((a, b) => b.spent - a.spent);
    const spent7dTotal = spend.reduce((sum, r) => sum + r.spent, 0);
    const top = spend.slice(0, 5);

    const topIds = top.map((t) => t.tenantId);
    const nameRows = topIds.length
      ? await db.select({ id: tenants.id, name: tenants.name }).from(tenants).where(inArray(tenants.id, topIds))
      : [];
    const nameMap = new Map(nameRows.map((t) => [t.id, t.name]));
    const topSpenders = top.map((t) => ({
      tenantId: t.tenantId,
      name: nameMap.get(t.tenantId) ?? "Unknown",
      spent7d: t.spent,
    }));

    return {
      firmCount,
      individualCount,
      totalAccounts: firmCount + individualCount,
      totalCreditsOutstanding,
      paidCount,
      inTrialCount,
      trialsExpiringSoon,
      spent7dTotal,
      topSpenders,
    };
  }),

  /** Provision a new firm account. */
  provisionFirm: superAdminProcedure
    .input(
      z.object({
        name: z.string().min(1).max(255),
        slug: z.string().min(1).max(128),
        plan: z.enum(["none", "starter", "pro", "team"]).default("none"),
        seats: z.number().int().min(1).default(1),
        initialCredits: z.number().int().min(0).default(0),
        ownerEmail: z.string().email().optional(),
        domainLock: z.string().max(255).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      // Check slug uniqueness
      const [existing] = await db
        .select()
        .from(tenants)
        .where(eq(tenants.slug, input.slug))
        .limit(1);
      if (existing) {
        throw new TRPCError({ code: "CONFLICT", message: "Slug already in use" });
      }

      // Ensure a default category exists
      const { categories } = await import("../../drizzle/schema");
      let [cat] = await db.select().from(categories).limit(1);
      if (!cat) {
        await db.insert(categories).values({ name: "Default", slug: "default" });
        [cat] = await db.select().from(categories).limit(1);
      }

      const tenant = await createTenant({
        name: input.name,
        slug: input.slug,
        categoryId: cat!.id,
        type: "firm",
        plan: input.plan,
        seats: input.seats,
        creditBalance: 0,
        allowedEmailDomain: input.domainLock || null,
      });

      if (!tenant) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to create tenant" });
      }

      // If owner email provided, look up user and assign as owner
      if (input.ownerEmail) {
        const [ownerUser] = await db
          .select()
          .from(users)
          .where(eq(users.email, input.ownerEmail))
          .limit(1);

        if (ownerUser) {
          await createMembership({
            tenantId: tenant.id,
            userId: ownerUser.id,
            role: "owner",
            status: "active",
          });
        }
      }

      // Grant initial credits. grantCredits sets the balance AND writes the
      // matching append-only ledger row with a correct balanceAfter, so this is
      // the single source of truth — no manual creditBalance write afterward.
      if (input.initialCredits > 0) {
        await grantCredits(tenant.id, input.initialCredits, "grant", undefined, undefined);
      }

      return tenant;
    }),

  /** Invite an individual (creates a single-seat account). */
  inviteIndividual: superAdminProcedure
    .input(
      z.object({
        email: z.string().email(),
        initialCredits: z.number().int().min(0).default(50),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      // Look up user by email
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.email, input.email))
        .limit(1);

      // Generate slug from email
      const slug = input.email.split("@")[0].toLowerCase().replace(/[^a-z0-9]/g, "-");

      // Ensure a default category exists
      const { categories } = await import("../../drizzle/schema");
      let [cat] = await db.select().from(categories).limit(1);
      if (!cat) {
        await db.insert(categories).values({ name: "Default", slug: "default" });
        [cat] = await db.select().from(categories).limit(1);
      }

      const tenant = await createTenant({
        name: input.email.split("@")[0],
        slug,
        categoryId: cat!.id,
        type: "individual",
        plan: "none",
        seats: 1,
        creditBalance: 0,
        trialStartedAt: new Date(),
        trialCredits: input.initialCredits,
      });

      if (!tenant) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to create account" });
      }

      // If user exists, assign as owner
      if (user) {
        await createMembership({
          tenantId: tenant.id,
          userId: user.id,
          role: "owner",
          status: "active",
        });
      }

      // Grant initial credits
      if (input.initialCredits > 0) {
        await grantCredits(tenant.id, input.initialCredits, "grant", undefined, user?.id);
      }

      return { ...tenant, userExists: !!user };
    }),

  /** Grant credits to any account. */
  grantCredits: superAdminProcedure
    .input(
      z.object({
        tenantId: z.number().int(),
        amount: z.number().int().min(1),
        note: z.string().max(500).optional(),
        // Client-supplied idempotency key so a double-submit / retry can't
        // double-grant (grantCredits is idempotent on (refId, reason)).
        idempotencyKey: z.string().max(100).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const newBalance = await grantCredits(
        input.tenantId,
        input.amount,
        "grant",
        input.idempotencyKey ? `admin-grant-${input.idempotencyKey}` : undefined,
        undefined
      );
      return { newBalance };
    }),

  /** Impersonate — sets a signed JWT cookie scoped to the target account. */
  impersonate: superAdminProcedure
    .input(z.object({ tenantId: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const [tenant] = await db
        .select()
        .from(tenants)
        .where(eq(tenants.id, input.tenantId))
        .limit(1);

      if (!tenant) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Account not found" });
      }

      // Sign a short-lived impersonation JWT and set it as an httpOnly cookie
      const token = await signImpersonationToken(ctx.user.id, tenant.id, tenant.name);
      const isSecure = ctx.req.protocol === "https" ||
        (ctx.req.headers["x-forwarded-proto"] as string)?.includes("https");
      setImpersonationCookie(ctx.res, token, isSecure);

      return {
        tenantId: tenant.id,
        tenantName: tenant.name,
        tenantSlug: tenant.slug,
        type: tenant.type,
        plan: tenant.plan,
        creditBalance: tenant.creditBalance,
      };
    }),

  /** Exit impersonation — clears the impersonation cookie. */
  exitImpersonation: protectedProcedure.mutation(async ({ ctx }) => {
    const isSecure = ctx.req.protocol === "https" ||
      (ctx.req.headers["x-forwarded-proto"] as string)?.includes("https");
    clearImpersonationCookie(ctx.res, isSecure);
    return { success: true };
  }),

  /** Check current impersonation state (for the banner). */
  impersonationStatus: protectedProcedure.query(async ({ ctx }) => {
    const impersonation = await getImpersonationFromRequest(ctx.req);
    if (!impersonation) return { active: false as const };
    return {
      active: true as const,
      tenantId: impersonation.tenantId,
      tenantName: impersonation.tenantName,
      adminId: impersonation.adminId,
    };
  }),

  /** Check if the current user is a platform admin. */
  whoami: superAdminProcedure.query(async ({ ctx }) => {
    return { userId: ctx.user.id, name: ctx.user.name, isSuperAdmin: true };
  }),
});
