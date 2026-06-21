/**
 * Tenancy middleware for Print Studio.
 * Provides `tenantProcedure` and `tenantAdminProcedure` that inject
 * the resolved tenant + membership into the tRPC context.
 *
 * Supports server-side impersonation: if a valid impersonation JWT cookie is
 * present (set by the Platform Console), the middleware bypasses the membership
 * check and grants the super_admin owner-level access to the target tenant.
 */
import { TRPCError } from "@trpc/server";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure } from "./_core/trpc";
import { getDb } from "./db";
import { tenants, memberships } from "../drizzle/schema";
import { getImpersonationFromRequest } from "./impersonation";

export const tenantProcedure = protectedProcedure
  .input(z.object({ tenantId: z.number() }))
  .use(async ({ ctx, input, next }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

    // Resolve tenant
    const [tenant] = await db
      .select()
      .from(tenants)
      .where(eq(tenants.id, input.tenantId))
      .limit(1);

    if (!tenant) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Tenant not found" });
    }

    // Check for server-side impersonation cookie
    const impersonation = await getImpersonationFromRequest(ctx.req);
    if (impersonation && impersonation.tenantId === input.tenantId) {
      // Super_admin impersonating this tenant — act AS the tenant's real owner.
      // Mirroring the real owner row (not a synthetic id:-1) means mutations
      // keyed on ctx.membership.id — notably transferOwnership's current-owner
      // demotion — operate on a real row instead of no-op'ing and leaving the
      // tenant with two owners.
      const [ownerMembership] = await db
        .select()
        .from(memberships)
        .where(
          and(
            eq(memberships.tenantId, tenant.id),
            eq(memberships.role, "owner"),
            eq(memberships.status, "active")
          )
        )
        // Deterministic if a tenant somehow has >1 active owner (legacy data
        // from the very bug this fixes): always mirror the earliest (lowest id).
        .orderBy(memberships.id)
        .limit(1);

      // Fallback to a synthetic owner row only when the tenant has no active
      // owner (shouldn't happen for a provisioned tenant) so read access still
      // works; there is simply no real owner to demote on transfer in that case.
      const membership = ownerMembership ?? {
        id: -1,
        userId: ctx.user.id,
        tenantId: tenant.id,
        role: "owner" as const,
        status: "active" as const,
        invitedEmail: null,
        createdAt: new Date(),
      };

      return next({
        ctx: {
          ...ctx,
          tenant,
          membership,
          isImpersonating: true,
          impersonationAdminId: impersonation.adminId,
        },
      });
    }

    // Normal flow: resolve membership
    const [membership] = await db
      .select()
      .from(memberships)
      .where(
        and(
          eq(memberships.tenantId, tenant.id),
          eq(memberships.userId, ctx.user.id),
          eq(memberships.status, "active")
        )
      )
      .limit(1);

    if (!membership) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "You are not a member of this organization",
      });
    }

    return next({
      ctx: {
        ...ctx,
        tenant,
        membership,
        isImpersonating: false,
        impersonationAdminId: null,
      },
    });
  });

export const tenantAdminProcedure = tenantProcedure.use(async ({ ctx, next }) => {
  if (ctx.membership.role !== "owner" && ctx.membership.role !== "admin") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Admin or owner access required",
    });
  }
  return next({ ctx });
});

export const tenantOwnerProcedure = tenantProcedure.use(async ({ ctx, next }) => {
  if (ctx.membership.role !== "owner") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Only the account owner can perform this action",
    });
  }
  return next({ ctx });
});
