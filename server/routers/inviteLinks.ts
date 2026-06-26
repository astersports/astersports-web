/**
 * Invite Links router.
 * Handles creating, listing, redeeming, and revoking shareable invite links.
 * Used by both Platform Console (super_admin) and Studio Admin (tenant admin).
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq, and, or, desc, isNull, lt, gt, sql } from "drizzle-orm";
import { randomBytes } from "crypto";
import { router, protectedProcedure, publicProcedure } from "../_core/trpc";
import { getDb } from "../db";
import {
  inviteLinks,
  inviteLinkRedemptions,
  tenants,
  memberships,
  users,
  platformAdmins,
} from "../../drizzle/schema";
import { createTenant, createMembership, grantCredits, ensureCategory, countActiveMembers } from "../studioDb";
import { isEmailAllowedForTenant } from "../tenantDomains";
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

      // Verify the user is an active admin/owner of this tenant
      const [mem] = await db
        .select()
        .from(memberships)
        .where(
          and(
            eq(memberships.tenantId, input.tenantId),
            eq(memberships.userId, ctx.user.id),
            eq(memberships.status, "active")
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
   * Get invite link details by token. Public on purpose: the /join page shows a
   * preview of what's being accepted BEFORE forcing OAuth, so a recipient knows
   * what they're signing into. The token is the bearer secret (32 random chars);
   * this returns only invite metadata + the target org name, never user data.
   */
  getByToken: publicProcedure
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

      // Whitelisted public shape — only what the /join preview needs. Never echo
      // the bearer token, createdBy (user data), id, or lastRedeemedAt back to an
      // unauthenticated caller (avoids leaking the token into client logs/caches).
      const preview = (
        status: "active" | "expired" | "redeemed" | "revoked",
        tenantName: string | null
      ) => ({
        type: link.type,
        status,
        expiresAt: link.expiresAt,
        maxUses: link.maxUses,
        useCount: link.useCount,
        metadata: link.metadata,
        tenantName,
      });

      if (link.status === "revoked") return preview("revoked", null);
      if (link.expiresAt && new Date(link.expiresAt) < new Date()) return preview("expired", null);
      if (link.maxUses && link.useCount >= link.maxUses) return preview("redeemed", null);

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

      return preview(link.status, tenantName);
    }),

  /**
   * Redeem an invite link (authenticated user).
   * Creates the appropriate account/membership.
   */
  redeem: protectedProcedure
    .input(
      z.object({
        token: z.string().min(1),
        /** Firm links only: lets the new owner name their org at redemption.
         *  Falls back to the link's preset firmName, then the user's name. */
        orgName: z.string().trim().min(1).max(255).optional(),
      })
    )
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

      // Friendly pre-check for the common double-click / repeat-visit case. The
      // atomic claim below is the real backstop against concurrent redemptions.
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

      // ── Atomically claim one redemption slot ──────────────────────────────
      // A single conditional UPDATE: increment useCount only while the link is
      // active, unexpired, and under maxUses. MySQL row-locks the matched row and
      // evaluates `useCount < maxUses` under that lock, so two people clicking a
      // single-use (or capped) link can never both pass. Mirrors the atomic-debit
      // pattern in deductCredits. Replaces the old read-then-write check that let
      // concurrent redeemers race past the cap.
      const now = new Date();
      const claimRes = await db
        .update(inviteLinks)
        .set({
          useCount: sql`${inviteLinks.useCount} + 1`,
          lastRedeemedAt: now,
          // Single-use links flip to "redeemed" the moment they're claimed.
          status: sql`CASE WHEN ${inviteLinks.maxUses} = 1 THEN 'redeemed' ELSE ${inviteLinks.status} END`,
        })
        .where(
          and(
            eq(inviteLinks.id, link.id),
            eq(inviteLinks.status, "active"),
            or(isNull(inviteLinks.maxUses), lt(inviteLinks.useCount, inviteLinks.maxUses)),
            or(isNull(inviteLinks.expiresAt), gt(inviteLinks.expiresAt, now))
          )
        )
        .returning({ id: inviteLinks.id });

      // Postgres: .returning() yields one row per claimed link; length 0 => the predicate
      // (still active, under the use cap, unexpired) failed, so this redeem lost the race.
      const claimed = claimRes.length;
      if (claimed === 0) {
        // The claim failed its predicate — re-read to report an accurate reason.
        const [fresh] = await db
          .select()
          .from(inviteLinks)
          .where(eq(inviteLinks.id, link.id))
          .limit(1);
        if (!fresh || fresh.status === "revoked") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "This invite link has been revoked" });
        }
        // `<= now` mirrors the claim predicate's `gt(expiresAt, now)`: a link
        // expiring exactly at `now` fails the claim and must read as "expired",
        // not "usage limit".
        if (fresh.expiresAt && new Date(fresh.expiresAt) <= now) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "This invite link has expired" });
        }
        throw new TRPCError({ code: "BAD_REQUEST", message: "This invite link has reached its usage limit" });
      }

      // Undo the claim if downstream provisioning fails, so a failed redemption
      // never burns a use slot or strands a single-use link as "redeemed".
      const refundClaim = async () => {
        await db
          .update(inviteLinks)
          .set({
            useCount: sql`GREATEST(${inviteLinks.useCount} - 1, 0)`,
            status: sql`CASE WHEN ${inviteLinks.maxUses} = 1 THEN 'active' ELSE ${inviteLinks.status} END`,
          })
          .where(eq(inviteLinks.id, link.id));
      };

      const metadata = (link.metadata ?? {}) as Record<string, any>;
      let resultTenantId: number;

      try {
        if (link.type === "firm") {
          // Create a new firm for this user. The redeemer may name their own org
          // (input.orgName); otherwise fall back to the link preset, then their name.
          const firmName = input.orgName || metadata.firmName || ctx.user.name || "My Organization";
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

          // Enforce the tenant's domain lock on the JOIN path too — the multi-domain
          // set (with legacy single-domain fallback). isEmailAllowedForTenant returns
          // true when the org has no lock at all, so this is a no-op for open orgs but
          // closes the bypass where a tenant_domains-locked org (allowedEmailDomain
          // null) would otherwise accept join-link signups from any domain.
          if (!(await isEmailAllowedForTenant(link.tenantId, ctx.user.email, tenant.allowedEmailDomain))) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Your email isn't on this organization's allowed domains.",
            });
          }

          // Seat limit (single authoritative count; replaces the old dead
          // double-query). Pre-insert check — adequate for the link-capped flow,
          // since the atomic claim above already serializes redemptions of a
          // seat-bounded join link.
          const activeMembers = await countActiveMembers(link.tenantId);
          if (activeMembers >= tenant.seats) {
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
      } catch (err) {
        await refundClaim();
        throw err;
      }

      // Record the redemption audit row. Provisioning already succeeded and the
      // claim is committed, so the user IS in — if only this audit write fails
      // (a DB blip), don't hand the user an error for an account they actually
      // have. Log loudly for reconciliation instead. Re-use is still bounded: the
      // atomic claim already spent useCount (a single-use link is "redeemed"), and
      // the join path's membership check blocks a duplicate join. True one-shot
      // atomicity across provisioning would require the money-path helpers
      // (grantCredits) to share a single tx handle — an Architect-scoped refactor,
      // out of scope for this change.
      try {
        await db.insert(inviteLinkRedemptions).values({
          inviteLinkId: link.id,
          userId: ctx.user.id,
          tenantId: resultTenantId,
        });
      } catch (err) {
        console.error(
          `[invite-redeem] provisioned tenant ${resultTenantId} for user ${ctx.user.id} but failed ` +
          `to write the redemption audit row for link ${link.id}: ${(err as Error)?.message}`
        );
      }

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

      // Verify active admin access
      const [mem] = await db
        .select()
        .from(memberships)
        .where(
          and(
            eq(memberships.tenantId, input.tenantId),
            eq(memberships.userId, ctx.user.id),
            eq(memberships.status, "active")
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
