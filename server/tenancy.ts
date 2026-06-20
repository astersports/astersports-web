/**
 * Tenancy middleware for Print Studio.
 * Provides `tenantProcedure` and `tenantAdminProcedure` that inject
 * the resolved tenant + membership into the tRPC context.
 */
import { TRPCError } from "@trpc/server";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure } from "./_core/trpc";
import { getDb } from "./db";
import { tenants, memberships } from "../drizzle/schema";

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

    // Resolve membership
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
