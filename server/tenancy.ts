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
      // Super_admin impersonating this tenant — grant synthetic owner membership
      const syntheticMembership = {
        id: -1,
        userId: ctx.user.id,
        tenantId: tenant.id,
        role: "owner" as const,
        status: "active" as const,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      return next({
        ctx: {
          ...ctx,
          tenant,
          membership: syntheticMembership,
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
