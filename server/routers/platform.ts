/**
 * Platform Console router — super_admin only.
 * Provides account listing, provisioning, credit granting, and impersonation.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq, sql } from "drizzle-orm";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { tenants, memberships, platformAdmins, users, creditLedger } from "../../drizzle/schema";
import { grantCredits, createTenant, createMembership } from "../studioDb";
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
  /** List all accounts, optionally filtered by type. */
  listAccounts: superAdminProcedure
    .input(z.object({ type: z.enum(["firm", "individual", "all"]).default("all") }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];

      let query = db.select().from(tenants);
      if (input.type !== "all") {
        query = query.where(eq(tenants.type, input.type)) as typeof query;
      }

      const accounts = await query;

      // Attach member count and owner info for each account
      const enriched = await Promise.all(
        accounts.map(async (account) => {
          const mems = await db
            .select()
            .from(memberships)
            .where(eq(memberships.tenantId, account.id));

          const activeMembers = mems.filter((m) => m.status === "active").length;
          const ownerMem = mems.find((m) => m.role === "owner");

          let ownerEmail: string | null = null;
          if (ownerMem) {
            const [ownerUser] = await db
              .select({ email: users.email, name: users.name })
              .from(users)
              .where(eq(users.id, ownerMem.userId))
              .limit(1);
            ownerEmail = ownerUser?.email ?? null;
          }

          return {
            ...account,
            activeMembers,
            ownerEmail,
          };
        })
      );

      return enriched;
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
