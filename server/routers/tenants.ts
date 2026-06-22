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
  createTenant,
  ensureCategory,
  createMembership,
  listMemberships,
  countActiveMembers,
  countUserOwnedTenants,
  countUserOwnedTenantsSince,
  deleteTenantCascade,
  grantCredits,
} from "../studioDb";
import { emailAllowedForDomain } from "../../shared/domain";
import { ENV } from "../_core/env";
import { TRIAL_CREDITS } from "../../shared/billing";
import { eq, and, inArray, sql } from "drizzle-orm";
import { getDb } from "../db";
import { memberships, users, jobs, creditLedger } from "../../drizzle/schema";

// Self-serve create-org rate limits (F2 ruling, 2026-06-22): at most 2 orgs
// owned per user (lifetime) and 3 created per rolling 24h (burst). Query-based,
// no new table. The lifetime cap counts ALL owner memberships — the conservative
// bound that caps a user's total trial-credit minting regardless of channel.
const CREATE_ORG_LIFETIME_CAP = 2;
const CREATE_ORG_BURST_CAP = 3;
const CREATE_ORG_BURST_WINDOW_MS = 24 * 60 * 60 * 1000;

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

  /**
   * Self-serve organization creation. RE-ENABLED 2026-06-22 (ledger-safe) after
   * the M2 removal (2026-06-21), where the old `create` set `creditBalance`
   * directly with NO matching `creditLedger` row (balance↔ledger drift) and, as
   * an ungated `protectedProcedure`, let anyone mint credited trial tenants.
   *
   * This version: (F1) ships DARK behind `STUDIO_CREATE_ORG_LIVE` — the Flip
   * Authority money-path flip (CLAUDE.md §1), NOT the client `VITE_CREATE_ORG_LIVE`
   * (which only un-disables the dialog button); (F2) is per-user rate-limited
   * (lifetime + 24h burst) against trial-credit farming; (F3/F4) seeds credits
   * ONLY through `grantCredits` (balance + ledger in one tx), never a direct
   * `creditBalance` write, with best-effort teardown if provisioning fails.
   * Mirrors the shipped `inviteLinks.redeem` firm path.
   */
  create: protectedProcedure
    .input(z.object({ name: z.string().trim().min(1).max(255) }))
    .mutation(async ({ ctx, input }) => {
      // (F1) Server dark gate. Stays dark until Frank's env-verified flip; a
      // direct tRPC call hits this too (the client VITE flag isn't a security
      // boundary). Builders PREPARE the flip, never SET it.
      if (!ENV.studioCreateOrgLive) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Self-serve organization creation isn't available yet.",
        });
      }

      // (F2) Per-user rate limits — query-based, no new table.
      const ownedTotal = await countUserOwnedTenants(ctx.user.id);
      if (ownedTotal >= CREATE_ORG_LIFETIME_CAP) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: "You've reached the limit for organizations you can create. Ask an admin for an invite to add more.",
        });
      }
      const ownedRecently = await countUserOwnedTenantsSince(
        ctx.user.id,
        new Date(Date.now() - CREATE_ORG_BURST_WINDOW_MS)
      );
      if (ownedRecently >= CREATE_ORG_BURST_CAP) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: "You've created several organizations recently. Please try again later.",
        });
      }

      // (F3/F4) Ledger-safe provisioning. Balance starts at 0; TRIAL_CREDITS are
      // granted via grantCredits, which writes the matching creditLedger row in
      // one transaction (idempotent on refId+reason). NEVER set creditBalance
      // directly — that was the M2 drift bug.
      const category = await ensureCategory("Default", "default");
      if (!category) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to create category" });
      }

      const baseSlug =
        input.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "org";
      const tenant = await createTenant({
        name: input.name.trim(),
        slug: `${baseSlug}-${Date.now().toString(36)}`, // ensure uniqueness
        categoryId: category.id,
        type: "firm",
        plan: "none",
        seats: 5,
        creditBalance: 0,
        trialStartedAt: new Date(),
        trialCredits: TRIAL_CREDITS,
      });
      if (!tenant) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to create organization" });
      }

      // Owner membership + trial grant. On any downstream failure, best-effort
      // teardown so a half-provisioned org isn't stranded. grantCredits is
      // internally atomic, so a thrown grant left no credits/ledger row and the
      // tenant is safe to remove.
      try {
        await createMembership({ tenantId: tenant.id, userId: ctx.user.id, role: "owner", status: "active" });
        await grantCredits(tenant.id, TRIAL_CREDITS, "trial_creation", `signup-trial-${tenant.id}`, ctx.user.id);
      } catch (err) {
        try {
          await deleteTenantCascade(tenant.id);
        } catch (cleanupErr) {
          console.error(
            `[tenants.create] cleanup failed for partially-provisioned tenant ${tenant.id} ` +
            `(user ${ctx.user.id}): ${(cleanupErr as Error)?.message}`
          );
        }
        throw err;
      }

      return tenant;
    }),

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
