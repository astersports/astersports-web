/**
 * Firm Admin router — spend-by-member aggregation, role toggles,
 * transfer ownership, and domain lock management.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router } from "../_core/trpc";
import { tenantAdminProcedure, tenantOwnerProcedure } from "../tenancy";
import { getDb } from "../db";
import { creditLedger, memberships, users, tenants } from "../../drizzle/schema";
import { eq, and, gte, sql, desc } from "drizzle-orm";
import { countActiveMembers } from "../studioDb";

export const firmAdminRouter = router({
  /**
   * Spend-by-member: aggregates credit usage per user for the tenant.
   * Returns both 7-day and all-time spend.
   */
  spendByMember: tenantAdminProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) return { members: [], totalSpent7d: 0, totalSpentAll: 0 };

    const tenantId = ctx.tenant.id;
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    // All-time spend per user (only debits, i.e. negative deltas)
    const allTimeSpend = await db
      .select({
        userId: creditLedger.userId,
        totalSpent: sql<number>`ABS(SUM(CASE WHEN ${creditLedger.delta} < 0 THEN ${creditLedger.delta} ELSE 0 END))`,
      })
      .from(creditLedger)
      .where(eq(creditLedger.tenantId, tenantId))
      .groupBy(creditLedger.userId);

    // 7-day spend per user
    const weekSpend = await db
      .select({
        userId: creditLedger.userId,
        totalSpent: sql<number>`ABS(SUM(CASE WHEN ${creditLedger.delta} < 0 THEN ${creditLedger.delta} ELSE 0 END))`,
      })
      .from(creditLedger)
      .where(
        and(
          eq(creditLedger.tenantId, tenantId),
          gte(creditLedger.createdAt, sevenDaysAgo)
        )
      )
      .groupBy(creditLedger.userId);

    // Get user names for enrichment
    const userIds = Array.from(new Set(allTimeSpend.map((r) => r.userId).filter(Boolean))) as number[];
    let userMap: Record<number, { name: string | null; email: string | null }> = {};

    if (userIds.length > 0) {
      const userRows = await db
        .select({ id: users.id, name: users.name, email: users.email })
        .from(users)
        .where(sql`${users.id} IN (${sql.join(userIds.map((id) => sql`${id}`), sql`, `)})`);
      userMap = Object.fromEntries(userRows.map((u) => [u.id, { name: u.name, email: u.email }]));
    }

    // mysql2 returns SQL aggregates (SUM/ABS) as strings, so coerce to Number
    // before summing — otherwise `0 + "495"` concatenates into "0495" (and gets
    // worse with multiple members), which surfaced as zero-padded totals on the
    // Admin "Spent" card and the Credit Ledger member summary.
    const totalSpent7d = weekSpend.reduce((sum, r) => sum + Number(r.totalSpent ?? 0), 0);
    const totalSpentAll = allTimeSpend.reduce((sum, r) => sum + Number(r.totalSpent ?? 0), 0);

    const members = allTimeSpend
      .filter((r) => r.userId)
      .map((r) => {
        const weekRow = weekSpend.find((w) => w.userId === r.userId);
        const user = userMap[r.userId!];
        return {
          userId: r.userId!,
          name: user?.name ?? "Unknown",
          email: user?.email ?? null,
          spentAll: Number(r.totalSpent ?? 0),
          spent7d: Number(weekRow?.totalSpent ?? 0),
        };
      })
      .sort((a, b) => b.spent7d - a.spent7d);

    return { members, totalSpent7d, totalSpentAll };
  }),

  /**
   * Toggle a member's role between "admin" and "member".
   * The owner role is immutable here, and the last remaining admin/owner cannot
   * be demoted (guarded below).
   */
  toggleRole: tenantAdminProcedure
    .input(
      z.object({
        membershipId: z.number(),
        field: z.enum(["role"]),
        value: z.enum(["admin", "member"]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      // Get the target membership
      const [target] = await db
        .select()
        .from(memberships)
        .where(
          and(
            eq(memberships.id, input.membershipId),
            eq(memberships.tenantId, ctx.tenant.id)
          )
        )
        .limit(1);

      if (!target) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Member not found" });
      }

      // Cannot change owner's role
      if (target.role === "owner") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot change the owner's role" });
      }

      // If promoting to admin, just update
      // If demoting to member, check they're not the only admin
      if (input.value === "member" && target.role === "admin") {
        // Count other admins/owners
        const adminCount = await db
          .select({ count: sql<number>`COUNT(*)` })
          .from(memberships)
          .where(
            and(
              eq(memberships.tenantId, ctx.tenant.id),
              sql`${memberships.role} IN ('admin', 'owner')`,
              sql`${memberships.id} != ${input.membershipId}`,
              eq(memberships.status, "active")
            )
          );

        if ((adminCount[0]?.count ?? 0) === 0) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Cannot remove the last admin. Transfer ownership first.",
          });
        }
      }

      // If promoting to admin from member, no seat check needed (admin alone doesn't cost a seat)
      // But per current schema, role is a single enum. We'll use it directly.
      await db
        .update(memberships)
        .set({ role: input.value })
        .where(eq(memberships.id, input.membershipId));

      return { success: true, newRole: input.value };
    }),

  /**
   * Transfer ownership to another active member.
   * Owner-only. The current owner becomes an admin.
   */
  transferOwnership: tenantOwnerProcedure
    .input(z.object({ targetMembershipId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      // Validate target is an active member of this tenant
      const [target] = await db
        .select()
        .from(memberships)
        .where(
          and(
            eq(memberships.id, input.targetMembershipId),
            eq(memberships.tenantId, ctx.tenant.id),
            eq(memberships.status, "active")
          )
        )
        .limit(1);

      if (!target) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Target member not found or inactive" });
      }

      if (target.role === "owner") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Target is already the owner" });
      }

      // Transfer: current owner → admin, target → owner
      await db
        .update(memberships)
        .set({ role: "admin" })
        .where(eq(memberships.id, ctx.membership.id));

      await db
        .update(memberships)
        .set({ role: "owner" })
        .where(eq(memberships.id, input.targetMembershipId));

      return { success: true, newOwnerId: target.userId };
    }),

  /**
   * Update the domain lock setting for the firm.
   * Admin or owner can change this.
   */
  updateDomainLock: tenantAdminProcedure
    .input(
      z.object({
        allowedEmailDomain: z.string().max(255).nullable(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      await db
        .update(tenants)
        .set({ allowedEmailDomain: input.allowedEmailDomain })
        .where(eq(tenants.id, ctx.tenant.id));

      return { success: true, allowedEmailDomain: input.allowedEmailDomain };
    }),

  /**
   * Remove a member from the firm (admin or owner only).
   * Cannot remove the owner.
   */
  removeMember: tenantAdminProcedure
    .input(z.object({ membershipId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const [target] = await db
        .select()
        .from(memberships)
        .where(
          and(
            eq(memberships.id, input.membershipId),
            eq(memberships.tenantId, ctx.tenant.id)
          )
        )
        .limit(1);

      if (!target) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Member not found" });
      }

      if (target.role === "owner") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot remove the owner" });
      }

      // Set status to disabled rather than deleting (keep history)
      await db
        .update(memberships)
        .set({ status: "disabled" })
        .where(eq(memberships.id, input.membershipId));

      return { success: true };
    }),
});
