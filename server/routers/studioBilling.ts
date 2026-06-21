/**
 * Studio Billing router — handles subscription management, top-ups, and credit history.
 * Uses the same Stripe account as the main app, with separate products for Studio plans.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router } from "../_core/trpc";
import { tenantProcedure, tenantAdminProcedure, tenantOwnerProcedure } from "../tenancy";
import { stripe, ensureStudioPrice } from "../stripe";
import { getCreditHistory, updateTenantStripe, grantCredits, getTrialStatus } from "../studioDb";
import { PLANS, TOPUP_PACKS, type PlanKey } from "../../shared/billing";
import { createOrgSetupIntent, cancelTrialAndFreezeCredits } from "../shadowBilling";

// `ensureStudioPrice` now lives in `../stripe` (shared with shadowBilling;
// kept there to avoid a studioBilling <-> shadowBilling import cycle).

export const studioBillingRouter = router({
  /** Get credit history for the tenant. */
  creditHistory: tenantProcedure.query(async ({ ctx }) => {
    return getCreditHistory(ctx.tenant.id);
  }),

  /** Create a Stripe Checkout session for a subscription plan. */
  subscribe: tenantAdminProcedure
    .input(z.object({ plan: z.enum(["starter", "pro", "team"]) }))
    .mutation(async ({ ctx, input }) => {
      const planDef = PLANS[input.plan];
      // M7: round to whole cents so a non-integer dollar price can't produce a
      // fractional-cent amount that Stripe rejects or rounds unexpectedly.
      const amountCents = Math.round(planDef.priceMonthly * 100);
      const priceId = await ensureStudioPrice(
        `Print Studio ${planDef.name}`,
        amountCents,
        "month"
      );

      // Ensure Stripe customer
      let customerId = ctx.tenant.stripeCustomerId;
      if (!customerId) {
        const customer = await stripe.customers.create({
          name: ctx.tenant.name,
          email: ctx.user.email ?? undefined,
          metadata: { tenantId: String(ctx.tenant.id), product: "print-studio" },
        });
        customerId = customer.id;
        await updateTenantStripe(ctx.tenant.id, { stripeCustomerId: customerId });
      }

      const origin = ctx.req.headers.origin || "https://astersports.io";
      const seats = planDef.perSeat ? ctx.tenant.seats : 1;
      const session = await stripe.checkout.sessions.create({
        customer: customerId,
        customer_email: !customerId ? (ctx.user.email ?? undefined) : undefined,
        client_reference_id: String(ctx.user.id),
        mode: "subscription",
        line_items: [{ price: priceId, quantity: seats }],
        success_url: `${origin}/studio/billing?success=1`,
        cancel_url: `${origin}/studio/billing?canceled=1`,
        allow_promotion_codes: true,
        metadata: {
          tenantId: String(ctx.tenant.id),
          plan: input.plan,
          product: "print-studio",
          user_id: String(ctx.user.id),
          customer_email: ctx.user.email ?? "",
          customer_name: ctx.user.name ?? "",
          seats: String(seats),
        },
        subscription_data: {
          metadata: {
            tenantId: String(ctx.tenant.id),
            plan: input.plan,
            product: "print-studio",
            seats: String(seats),
          },
        },
      });

      return { checkoutUrl: session.url };
    }),

  /** Create a Stripe Checkout session for a credit top-up. */
  topup: tenantAdminProcedure
    .input(z.object({ packKey: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const pack = TOPUP_PACKS.find((p) => p.key === input.packKey);
      if (!pack) throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid pack" });

      const amountCents = Math.round(pack.priceUsd * 100); // M7: whole cents
      const priceId = await ensureStudioPrice(`Print Studio Top-up: ${pack.name}`, amountCents);

      // Ensure Stripe customer
      let customerId = ctx.tenant.stripeCustomerId;
      if (!customerId) {
        const customer = await stripe.customers.create({
          name: ctx.tenant.name,
          email: ctx.user.email ?? undefined,
          metadata: { tenantId: String(ctx.tenant.id), product: "print-studio" },
        });
        customerId = customer.id;
        await updateTenantStripe(ctx.tenant.id, { stripeCustomerId: customerId });
      }

      const origin = ctx.req.headers.origin || "https://astersports.io";
      const session = await stripe.checkout.sessions.create({
        customer: customerId,
        client_reference_id: String(ctx.user.id),
        mode: "payment",
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: `${origin}/studio/billing?topup=success`,
        cancel_url: `${origin}/studio/billing?topup=canceled`,
        allow_promotion_codes: true,
        metadata: {
          tenantId: String(ctx.tenant.id),
          packKey: input.packKey,
          credits: String(pack.credits),
          product: "print-studio",
          user_id: String(ctx.user.id),
          customer_email: ctx.user.email ?? "",
          customer_name: ctx.user.name ?? "",
        },
      });

      return { checkoutUrl: session.url };
    }),

  /** Open Stripe Customer Portal for the tenant. */
  portal: tenantAdminProcedure.mutation(async ({ ctx }) => {
    if (!ctx.tenant.stripeCustomerId) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "No billing account yet" });
    }

    const origin = ctx.req.headers.origin || "https://astersports.io";
    const session = await stripe.billingPortal.sessions.create({
      customer: ctx.tenant.stripeCustomerId,
      return_url: `${origin}/studio/billing`,
    });

    return { portalUrl: session.url };
  }),

  /** Get current plan info. */
  planInfo: tenantProcedure.query(async ({ ctx }) => {
    return {
      plan: ctx.tenant.plan,
      creditBalance: ctx.tenant.creditBalance,
      seats: ctx.tenant.seats,
      stripeCustomerId: ctx.tenant.stripeCustomerId,
      stripeSubscriptionId: ctx.tenant.stripeSubscriptionId,
    };
  }),

  /** Enriched billing status with trial info, role, and subscription details. */
  billingStatus: tenantProcedure.query(async ({ ctx }) => {
    const trial = getTrialStatus(ctx.tenant);
    const role = ctx.membership.role;
    const isOwner = role === "owner";

    return {
      role,
      isOwner,
      plan: ctx.tenant.plan,
      type: ctx.tenant.type,
      creditBalance: ctx.tenant.creditBalance,
      seats: ctx.tenant.seats,
      stripeCustomerId: ctx.tenant.stripeCustomerId,
      stripeSubscriptionId: ctx.tenant.stripeSubscriptionId,
      hasCardOnFile: !!ctx.tenant.stripePaymentMethodId,
      frozenCredits: ctx.tenant.trialFrozenCredits ?? 0,
      trial: {
        inTrial: trial.inTrial,
        daysRemaining: trial.daysRemaining,
        trialDay: trial.trialDay,
        expired: trial.expired,
        trialCredits: ctx.tenant.trialCredits,
        trialStartedAt: ctx.tenant.trialStartedAt?.toISOString() ?? null,
      },
    };
  }),

  /** Create a SetupIntent to collect org-level card on file (owner only). */
  setupCardOnFile: tenantOwnerProcedure.mutation(async ({ ctx }) => {
    const result = await createOrgSetupIntent(
      ctx.tenant.id,
      ctx.tenant.name,
      ctx.user.email ?? "unknown@org"
    );
    return { clientSecret: result.clientSecret };
  }),

  /** Cancel trial — owner only. Freezes credits, clears card on file. */
  cancelTrial: tenantOwnerProcedure.mutation(async ({ ctx }) => {
    // If there's an active subscription, cancel it
    if (ctx.tenant.stripeSubscriptionId) {
      await stripe.subscriptions.cancel(ctx.tenant.stripeSubscriptionId);
      await updateTenantStripe(ctx.tenant.id, {
        stripeSubscriptionId: undefined,
        plan: "none",
      });
    }
    // Freeze trial credits
    const { frozenCredits } = await cancelTrialAndFreezeCredits(ctx.tenant.id);
    return { success: true, frozenCredits };
  }),

  /** Start plan now — owner only. Ends trial immediately and activates the plan. */
  startNow: tenantOwnerProcedure.mutation(async ({ ctx }) => {
    if (!ctx.tenant.stripeSubscriptionId) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "No subscription to activate" });
    }
    // End trial immediately by updating the subscription
    await stripe.subscriptions.update(ctx.tenant.stripeSubscriptionId, {
      trial_end: "now",
    });
    return { success: true };
  }),
});
