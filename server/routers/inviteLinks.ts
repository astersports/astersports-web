/**
 * Invite Links router.
 * Handles creating, listing, redeeming, and revoking shareable invite links.
 * Used by both Platform Console (super_admin) and Studio Admin (tenant admin).
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq, and, desc, sql, lt } from "drizzle-orm";
import { randomBytes } from "crypto";
import { router, protectedProcedure } from "../_core/trpc";
import { getDb } from "../db";
import {
  inviteLinks,
  inviteLinkRedemptions,
  tenants,
  memberships,
  users,
  platformAdmins,
} from "../../drizzle/schema";
import { createTenant, createMembership, grantCredits, ensureCategory } from "../studioDb";
import { emailAllowedForDomain } from "../../shared/domain";
import { TRIAL_CREDITS } from "../../shared/billing";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function generateToken(): string {
  return randomBytes(24).toString("base64url"); // 32 chars, URL-safe
}

// ─── Middleware: platform admin check ─────────────────────────────────────────

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

// ─── Metadata schema ──────────────────────────────────────────────────────────

const firmMetadataSchema = z.object({
  firmName: z.string().min(1).max(255).optional(),
  plan: z.enum(["none", "starter", "pro", "team"]).default("none"),
  seats: z.number().int().min(1).default(5),
  initialCredits: z.number().int().min(0).default(0),
  domainLock: z.string().max(255).optional(),
});

const individualMetadataSchema = z.object({
  initialCredits: z.number().int().min(0).default(50),
});

const joinMetadataSchema = z.object({
  role: z.enum(["admin", "member"]).default("member"),
});

// ─── Router ───────────────────────────────────────────────────────────────────

export const inviteLinksRouter = router({
  /**
   * Create an invite link (platform admin).
   * Supports firm, individual, and join types.
   */
  create: superAdminProcedure
    .input(
      z.discriminatedUnion("type", [
        z.object({
          type: z.literal("firm"),
          metadata: firmMetadataSchema,
          maxUses: z.number().int().min(1).nullable().default(1),
          expiresInDays: z.number().int().min(1).nullable().default(30),
        }),
        z.object({
          type: z.literal("individual"),
          metadata: individualMetadataSchema,
          maxUses: z.number().int().min(1).nullable().default(1),
          expiresInDays: z.number().int().min(1).nullable().default(30),
        }),
        z.object({
          type: z.literal("join"),
          tenantId: z.number().int(),
          metadata: joinMetadataSchema,
          maxUses: z.number().int().min(1).nullable().default(null),
          expiresInDays: z.number().int().min(1).nullable().default(30),
        }),
      ])
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const token = generateToken();
      const expiresAt = input.expiresInDays
        ? new Date(Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000)
        : null;

      const tenantId = input.type === "join" ? input.tenantId : null;

      await db.insert(inviteLinks).values({
        token,
        type: input.type,
        status: "active",
        tenantId,
        metadata: input.metadata,
        maxUses: input.maxUses,
        useCount: 0,
        expiresAt,
        createdBy: ctx.user.id,
      });

      return { token };
    }),

  /**
   * Create a join link for a specific tenant (tenant admin).
   * This is used from the Studio Admin page.
   */
  createJoinLink: protectedProcedure
    .input(
      z.object({
        tenantId: z.number().int(),
        role: z.enum(["admin", "member"]).default("member"),
        maxUses: z.number().int().min(1).nullable().default(null),
        expiresInDays: z.number().int().min(1).nullable().default(30),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      // Verify the user is admin/owner of this tenant
      const [mem] = await db
        .select()
        .from(memberships)
        .where(
          and(
            eq(memberships.tenantId, input.tenantId),
            eq(memberships.userId, ctx.user.id)
          )
        )
        .limit(1);

      if (!mem || (mem.role !== "owner" && mem.role !== "admin")) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Admin access required" });
      }

      const token = generateToken();
      const expiresAt = input.expiresInDays
        ? new Date(Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000)
        : null;

      await db.insert(inviteLinks).values({
        token,
        type: "join",
        status: "active",
        tenantId: input.tenantId,
        metadata: { role: input.role },
        maxUses: input.maxUses,
        useCount: 0,
        expiresAt,
        createdBy: ctx.user.id,
      });

      return { token };
    }),

  /**
   * Get invite link details by token (public — used by the /join page).
   */
  getByToken: protectedProcedure
    .input(z.object({ token: z.string().min(1) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const [link] = await db
        .select()
        .from(inviteLinks)
        .where(eq(inviteLinks.token, input.token))
        .limit(1);

      if (!link) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Invite link not found" });
      }

      // Check if expired
      if (link.expiresAt && new Date(link.expiresAt) < new Date()) {
        return { ...link, status: "expired" as const, tenantName: null };
      }

      // Check if max uses reached
      if (link.maxUses && link.useCount >= link.maxUses) {
        return { ...link, status: "redeemed" as const, tenantName: null };
      }

      // Get tenant name for join links
      let tenantName: string | null = null;
      if (link.tenantId) {
        const [tenant] = await db
          .select({ name: tenants.name })
          .from(tenants)
          .where(eq(tenants.id, link.tenantId))
          .limit(1);
        tenantName = tenant?.name ?? null;
      }

      return { ...link, tenantName };
    }),

  /**
   * Redeem an invite link (authenticated user).
   * Creates the appropriate account/membership.
   */
  redeem: protectedProcedure
    .input(z.object({ token: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const [link] = await db
        .select()
        .from(inviteLinks)
        .where(eq(inviteLinks.token, input.token))
        .limit(1);

      if (!link) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Invite link not found" });
      }

      // Validate link is still active
      if (link.status === "revoked") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "This invite link has been revoked" });
      }
      if (link.expiresAt && new Date(link.expiresAt) < new Date()) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "This invite link has expired" });
      }
      if (link.maxUses && link.useCount >= link.maxUses) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "This invite link has reached its usage limit" });
      }

      // Check if user already redeemed this link
      const [existingRedemption] = await db
        .select()
        .from(inviteLinkRedemptions)
        .where(
          and(
            eq(inviteLinkRedemptions.inviteLinkId, link.id),
            eq(inviteLinkRedemptions.userId, ctx.user.id)
          )
        )
        .limit(1);

      if (existingRedemption) {
        throw new TRPCError({ code: "CONFLICT", message: "You have already used this invite link" });
      }

      // Atomically CLAIM a usage slot BEFORE creating any tenant/credits. The old
      // code incremented useCount only at the end, so two concurrent redemptions
      // of a near-limit / single-use link both passed the check above and both
      // minted a tenant + credits (free-credit mint). This conditional update
      // increments useCount only while a slot remains and aborts if it didn't
      // claim one. maxUses falsy (0/null) = unlimited.
      const claim = await db
        .update(inviteLinks)
        .set({
          useCount: sql`${inviteLinks.useCount} + 1`,
          lastRedeemedAt: new Date(),
          ...(link.maxUses === 1 ? { status: "redeemed" } : {}),
        })
        .where(
          and(
            eq(inviteLinks.id, link.id),
            link.maxUses ? lt(inviteLinks.useCount, link.maxUses) : undefined
          )
        );
      if (((claim as any)?.[0]?.affectedRows ?? 0) === 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "This invite link has reached its usage limit" });
      }

      const metadata = (link.metadata ?? {}) as Record<string, any>;
      let resultTenantId: number;

      if (link.type === "firm") {
        // Create a new firm for this user
        const firmName = metadata.firmName || ctx.user.name || "My Organization";
        const slug = firmName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

        const category = await ensureCategory("Default", "default");
        if (!category) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to create category" });

        const tenant = await createTenant({
          name: firmName,
          slug: `${slug}-${Date.now().toString(36)}`, // Ensure uniqueness
          categoryId: category.id,
          type: "firm",
          plan: metadata.plan || "none",
          seats: metadata.seats || 5,
          creditBalance: 0,
          allowedEmailDomain: metadata.domainLock || null,
          trialStartedAt: new Date(),
          trialCredits: metadata.initialCredits || TRIAL_CREDITS,
        });

        if (!tenant) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to create organization" });

        await createMembership({
          tenantId: tenant.id,
          userId: ctx.user.id,
          role: "owner",
          status: "active",
        });

        // Grant initial credits
        const credits = metadata.initialCredits || TRIAL_CREDITS;
        if (credits > 0) {
          await grantCredits(tenant.id, credits, "grant", undefined, ctx.user.id);
        }

        resultTenantId = tenant.id;

      } else if (link.type === "individual") {
        // Create a single-seat individual account
        const name = ctx.user.name || ctx.user.email?.split("@")[0] || "User";
        const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

        const category = await ensureCategory("Default", "default");
        if (!category) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to create category" });

        const tenant = await createTenant({
          name,
          slug: `${slug}-${Date.now().toString(36)}`,
          categoryId: category.id,
          type: "individual",
          plan: "none",
          seats: 1,
          creditBalance: 0,
          trialStartedAt: new Date(),
          trialCredits: metadata.initialCredits || 50,
        });

        if (!tenant) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to create account" });

        await createMembership({
          tenantId: tenant.id,
          userId: ctx.user.id,
          role: "owner",
          status: "active",
        });

        const credits = metadata.initialCredits || 50;
        if (credits > 0) {
          await grantCredits(tenant.id, credits, "grant", undefined, ctx.user.id);
        }

        resultTenantId = tenant.id;

      } else {
        // Join an existing tenant
        if (!link.tenantId) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid join link — no tenant specified" });
        }

        // Check if already a member
        const [existingMem] = await db
          .select()
          .from(memberships)
          .where(
            and(
              eq(memberships.tenantId, link.tenantId),
              eq(memberships.userId, ctx.user.id)
            )
          )
          .limit(1);

        if (existingMem) {
          throw new TRPCError({ code: "CONFLICT", message: "You are already a member of this organization" });
        }

        // Check domain lock
        const [tenant] = await db
          .select()
          .from(tenants)
          .where(eq(tenants.id, link.tenantId))
          .limit(1);

        if (!tenant) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Organization not found" });
        }

        if (tenant.allowedEmailDomain && ctx.user.email) {
          if (!emailAllowedForDomain(ctx.user.email, tenant.allowedEmailDomain)) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `This organization requires a @${tenant.allowedEmailDomain} email address`,
            });
          }
        }

        // Check seat limit
        const [seatCount] = await db
          .select({ count: memberships.id })
          .from(memberships)
          .where(
            and(
              eq(memberships.tenantId, link.tenantId),
              eq(memberships.status, "active")
            )
          );

        // Simple count approach
        const activeMembers = await db
          .select()
          .from(memberships)
          .where(
            and(
              eq(memberships.tenantId, link.tenantId),
              eq(memberships.status, "active")
            )
          );

        if (activeMembers.length >= tenant.seats) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `This organization has reached its seat limit (${tenant.seats})`,
          });
        }

        await createMembership({
          tenantId: link.tenantId,
          userId: ctx.user.id,
          role: metadata.role || "member",
          status: "active",
        });

        resultTenantId = link.tenantId;
      }

      // Record redemption (the usage slot was already claimed atomically above).
      await db.insert(inviteLinkRedemptions).values({
        inviteLinkId: link.id,
        userId: ctx.user.id,
        tenantId: resultTenantId,
      });

      return { success: true, tenantId: resultTenantId };
    }),

  /**
   * List all invite links (platform admin).
   */
  list: superAdminProcedure
    .input(
      z.object({
        status: z.enum(["active", "redeemed", "expired", "revoked", "all"]).default("all"),
      })
    )
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];

      let query = db
        .select()
        .from(inviteLinks)
        .orderBy(desc(inviteLinks.createdAt));

      if (input.status !== "all") {
        query = query.where(eq(inviteLinks.status, input.status)) as typeof query;
      }

      const links = await query;

      // Enrich with tenant names and creator info
      const enriched = await Promise.all(
        links.map(async (link) => {
          let tenantName: string | null = null;
          if (link.tenantId) {
            const [t] = await db
              .select({ name: tenants.name })
              .from(tenants)
              .where(eq(tenants.id, link.tenantId))
              .limit(1);
            tenantName = t?.name ?? null;
          }

          const [creator] = await db
            .select({ name: users.name, email: users.email })
            .from(users)
            .where(eq(users.id, link.createdBy))
            .limit(1);

          // Check if expired (status might still say active but date passed)
          const isExpired = link.expiresAt && new Date(link.expiresAt) < new Date();
          const effectiveStatus = isExpired && link.status === "active" ? "expired" : link.status;

          return {
            ...link,
            tenantName,
            creatorName: creator?.name ?? creator?.email ?? "Unknown",
            effectiveStatus,
          };
        })
      );

      return enriched;
    }),

  /**
   * List join links for a specific tenant (tenant admin).
   */
  listForTenant: protectedProcedure
    .input(z.object({ tenantId: z.number().int() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return [];

      // Verify admin access
      const [mem] = await db
        .select()
        .from(memberships)
        .where(
          and(
            eq(memberships.tenantId, input.tenantId),
            eq(memberships.userId, ctx.user.id)
          )
        )
        .limit(1);

      if (!mem || (mem.role !== "owner" && mem.role !== "admin")) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Admin access required" });
      }

      const links = await db
        .select()
        .from(inviteLinks)
        .where(
          and(
            eq(inviteLinks.tenantId, input.tenantId),
            eq(inviteLinks.type, "join")
          )
        )
        .orderBy(desc(inviteLinks.createdAt));

      return links.map((link) => {
        const isExpired = link.expiresAt && new Date(link.expiresAt) < new Date();
        const effectiveStatus = isExpired && link.status === "active" ? "expired" : link.status;
        return { ...link, effectiveStatus };
      });
    }),

  /**
   * Revoke an invite link (platform admin or tenant admin who created it).
   */
  revoke: protectedProcedure
    .input(z.object({ token: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const [link] = await db
        .select()
        .from(inviteLinks)
        .where(eq(inviteLinks.token, input.token))
        .limit(1);

      if (!link) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Invite link not found" });
      }

      // Check permission: must be creator or platform admin
      const [admin] = await db
        .select()
        .from(platformAdmins)
        .where(eq(platformAdmins.userId, ctx.user.id))
        .limit(1);

      if (!admin && link.createdBy !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "You can only revoke links you created" });
      }

      await db
        .update(inviteLinks)
        .set({ status: "revoked" })
        .where(eq(inviteLinks.id, link.id));

      return { success: true };
    }),
});
