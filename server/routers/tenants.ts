/**
 * Tenant management router.
 * Handles listing user tenants, creating tenants, inviting members, etc.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../_core/trpc";
import { tenantAdminProcedure } from "../tenancy";
import {
  getUserTenants,
  createMembership,
  listMemberships,
  countActiveMembers,
} from "../studioDb";
import { emailAllowedForDomain } from "../../shared/domain";
import { eq, and, inArray, sql } from "drizzle-orm";
import { getDb } from "../db";
import { memberships, users, jobs, creditLedger } from "../../drizzle/schema";

export const tenantsRouter = router({
  /** List all tenants the current user belongs to. */
  myTenants: protectedProcedure.query(async ({ ctx }) => {
    return getUserTenants(ctx.user.id);
  }),

  /** Get a single tenant by ID (must be a member). */
  get: protectedProcedure
    .input(z.object({ tenantId: z.number() }))
    .query(async ({ ctx, input }) => {
      const tenants = await getUserTenants(ctx.user.id);
      const t = tenants.find((t) => t.id === input.tenantId);
      if (!t) throw new TRPCError({ code: "NOT_FOUND", message: "Tenant not found or you are not a member" });
      return t;
    }),

  /**
   * Multi-org overview: every org the user belongs to, enriched with the active
   * member count, for the Studio Admin "Your organizations" grid (Zone A). Reuses
   * getUserTenants (role + all tenant fields incl. `type`) + countActiveMembers.
   * Read-only; no money-path.
   */
  overview: protectedProcedure.query(async ({ ctx }) => {
    const orgs = await getUserTenants(ctx.user.id);
    return Promise.all(
      orgs.map(async (t) => ({ ...t, memberCount: await countActiveMembers(t.id) }))
    );
  }),

  // `create` (open self-serve tenant creation) was REMOVED 2026-06-21 (M2):
  // it set `creditBalance` directly with NO `creditLedger` row (balance↔ledger
  // drift) and, as a `protectedProcedure`, let any authenticated user mint
  // credited trial tenants. Tenant creation is now INVITE-ONLY — via
  // `inviteLinks.redeem` (firm/individual tokens) and platform admins
  // (`platform.provisionFirm` / `inviteIndividual`), all of which grant credits
  // through `grantCredits`, which writes the matching append-only ledger row.

  /**
   * List members of a tenant (admin-only), enriched for the member-management
   * UI: user info, joined date, last in-studio activity (last job, falling back
   * to last sign-in), job count, and per-member spend (7d + all-time). All
   * batched — 4 queries total regardless of member count, no per-member N+1.
   */
  members: tenantAdminProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) return [];
    const mems = await listMemberships(ctx.tenant.id);
    if (mems.length === 0) return [];
    const tenantId = ctx.tenant.id;
    const userIds = Array.from(new Set(mems.map((m) => m.userId)));
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const [userRows, jobAgg, spendAgg] = await Promise.all([
      db
        .select({ id: users.id, name: users.name, email: users.email, lastSignedIn: users.lastSignedIn })
        .from(users)
        .where(inArray(users.id, userIds)),
      db
        .select({
          userId: jobs.userId,
          jobsCount: sql<number>`COUNT(*)`,
          lastJobAt: sql<string | null>`MAX(${jobs.createdAt})`,
        })
        .from(jobs)
        .where(and(eq(jobs.tenantId, tenantId), inArray(jobs.userId, userIds)))
        .groupBy(jobs.userId),
      db
        .select({
          userId: creditLedger.userId,
          spentAll: sql<number>`ABS(SUM(CASE WHEN ${creditLedger.delta} < 0 THEN ${creditLedger.delta} ELSE 0 END))`,
          spent7d: sql<number>`ABS(SUM(CASE WHEN ${creditLedger.delta} < 0 AND ${creditLedger.createdAt} >= ${sevenDaysAgo} THEN ${creditLedger.delta} ELSE 0 END))`,
        })
        .from(creditLedger)
        .where(and(eq(creditLedger.tenantId, tenantId), inArray(creditLedger.userId, userIds)))
        .groupBy(creditLedger.userId),
    ]);

    const userMap = new Map(userRows.map((u) => [u.id, u]));
    const jobMap = new Map(jobAgg.map((j) => [j.userId, j]));
    const spendMap = new Map(spendAgg.map((s) => [s.userId, s]));

    return mems.map((m) => {
      const u = userMap.get(m.userId);
      const j = jobMap.get(m.userId);
      const s = spendMap.get(m.userId);
      const lastJobAt = j?.lastJobAt ? new Date(j.lastJobAt) : null;
      return {
        ...m,
        user: u ? { id: u.id, name: u.name, email: u.email } : null,
        joinedAt: m.createdAt,
        lastSignedIn: u?.lastSignedIn ?? null,
        // True in-studio activity (last generate); fall back to last sign-in.
        lastActiveAt: lastJobAt ?? u?.lastSignedIn ?? null,
        jobsCount: Number(j?.jobsCount ?? 0),
        spent7d: Number(s?.spent7d ?? 0),
        spentAll: Number(s?.spentAll ?? 0),
      };
    });
  }),

  /** Invite a member by email (admin-only). Validates domain restriction. */
  invite: tenantAdminProcedure
    .input(z.object({ email: z.string().email(), role: z.enum(["admin", "member"]).default("member") }))
    .mutation(async ({ ctx, input }) => {
      // Check domain restriction
      if (!emailAllowedForDomain(input.email, ctx.tenant.allowedEmailDomain)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Email must be from @${ctx.tenant.allowedEmailDomain}`,
        });
      }

      // Check seat limit
      const activeCount = await countActiveMembers(ctx.tenant.id);
      if (activeCount >= ctx.tenant.seats) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Seat limit reached (${ctx.tenant.seats}). Upgrade your plan for more seats.`,
        });
      }

      // Check if user already exists
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const [existingUser] = await db
        .select()
        .from(users)
        .where(eq(users.email, input.email))
        .limit(1);

      if (existingUser) {
        // Check if already a member
        const [existingMem] = await db
          .select()
          .from(memberships)
          .where(
            and(
              eq(memberships.tenantId, ctx.tenant.id),
              eq(memberships.userId, existingUser.id)
            )
          )
          .limit(1);

        if (existingMem) {
          throw new TRPCError({ code: "CONFLICT", message: "User is already a member" });
        }

        await createMembership({
          tenantId: ctx.tenant.id,
          userId: existingUser.id,
          role: input.role,
          status: "active",
        });
      } else {
        // Create an invited stub (userId = 0 placeholder, invitedEmail set)
        await createMembership({
          tenantId: ctx.tenant.id,
          userId: 0,
          role: input.role,
          status: "invited",
          invitedEmail: input.email,
        });
      }

      return { success: true };
    }),
});
