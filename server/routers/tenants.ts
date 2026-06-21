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
  getTenantById,
} from "../studioDb";
import { emailAllowedForDomain } from "../../shared/domain";
import { getUserByOpenId } from "../db";
import { eq, and } from "drizzle-orm";
import { getDb } from "../db";
import { memberships, users } from "../../drizzle/schema";

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

  // `create` (open self-serve tenant creation) was REMOVED 2026-06-21 (M2):
  // it set `creditBalance` directly with NO `creditLedger` row (balance↔ledger
  // drift) and, as a `protectedProcedure`, let any authenticated user mint
  // credited trial tenants. Tenant creation is now INVITE-ONLY — via
  // `inviteLinks.redeem` (firm/individual tokens) and platform admins
  // (`platform.inviteFirm` / `inviteIndividual`), all of which grant credits
  // through `grantCredits`, which writes the matching append-only ledger row.

  /** List members of a tenant (admin-only). */
  members: tenantAdminProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) return [];
    const mems = await listMemberships(ctx.tenant.id);
    // Enrich with user info
    const enriched = await Promise.all(
      mems.map(async (m) => {
        const [user] = await db
          .select({ id: users.id, name: users.name, email: users.email })
          .from(users)
          .where(eq(users.id, m.userId))
          .limit(1);
        return { ...m, user: user ?? null };
      })
    );
    return enriched;
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
