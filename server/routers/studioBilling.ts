/**
 * Studio Billing router — handles subscription management, top-ups, and credit history.
 * Uses the same Stripe account as the main app, with separate products for Studio plans.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router } from "../_core/trpc";
import { tenantProcedure, tenantAdminProcedure } from "../tenancy";
import { stripe } from "../stripe";
import { getCreditHistory, updateTenantStripe, grantCredits } from "../studioDb";
import { PLANS, TOPUP_PACKS, type PlanKey } from "../../shared/billing";

// ─── Stripe Product/Price cache for Studio ───────────────────────────────────

const priceCache: Map<string, string> = new Map();

async function ensureStudioPrice(
  productName: string,
  amountCents: number,
  interval?: "month"
): Promise<string> {
  const cacheKey = `${productName}-${amountCents}-${interval ?? "once"}`;
  if (priceCache.has(cacheKey)) return priceCache.get(cacheKey)!;

  // Search for existing product
  const products = await stripe.products.search({ query: `name:"${productName}"` });
  let productId: string;

  if (products.data.length > 0) {
    productId = products.data[0].id;
  } else {
    const product = await stripe.products.create({
      name: productName,
      description: `Aster Print Studio - ${productName}`,
    });
    productId = product.id;
  }

  // Search for matching price
  const prices = await stripe.prices.list({ product: productId, active: true, limit: 20 });
  const match = prices.data.find(
    (p) =>
      p.unit_amount === amountCents &&
      (interval ? p.recurring?.interval === interval : !p.recurring)
  );

  if (match) {
    priceCache.set(cacheKey, match.id);
    return match.id;
  }

  const priceData: any = {
    product: productId,
    unit_amount: amountCents,
    currency: "usd",
  };
  if (interval) priceData.recurring = { interval };

  const price = await stripe.prices.create(priceData);
  priceCache.set(cacheKey, price.id);
  return price.id;
}

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
      const amountCents = planDef.priceMonthly * 100;
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

      const amountCents = pack.priceUsd * 100;
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
});
