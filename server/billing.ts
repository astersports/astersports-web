import { z } from "zod";
import { eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "./_core/trpc";
import { stripe, ensureProducts } from "./stripe";
import { getDb } from "./db";
import { billingClients } from "../drizzle/schema";
import { ENV } from "./_core/env";

/**
 * Owner-only procedure: restricts access to the site owner (OWNER_OPEN_ID).
 * More restrictive than adminProcedure — only the owner can manage billing.
 */
const ownerProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  console.log(`[Billing] Owner check: user.openId="${ctx.user.openId}" vs ENV.ownerOpenId="${ENV.ownerOpenId}"`);
  if (!ENV.ownerOpenId) {
    // If OWNER_OPEN_ID is not set, fall back to admin role check
    if (ctx.user.role !== "admin") {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Only the site owner can access billing",
      });
    }
  } else if (ctx.user.openId !== ENV.ownerOpenId) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Only the site owner can access billing",
    });
  }
  return next({ ctx });
});

export const billingRouter = router({
  /**
   * List all billing clients with their subscription status.
   */
  listClients: ownerProcedure.query(async () => {
    const db = await getDb();
    if (!db) throw new Error("Database not available");

    const clients = await db.select().from(billingClients);
    return { clients };
  }),

  /**
   * Create a new Stripe customer and store in our DB.
   * Optionally creates a subscription immediately.
   */
  createClient: ownerProcedure
    .input(
      z.object({
        name: z.string().min(1, "Client name is required"),
        email: z.string().email("Valid email is required"),
        notes: z.string().optional(),
        createSubscription: z.boolean().default(false),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      // Create Stripe customer
      const customer = await stripe.customers.create({
        name: input.name,
        email: input.email,
        metadata: {
          source: "aster_sports_admin",
        },
      });

      let subscriptionId: string | null = null;
      let subscriptionStatus = "none";

      let checkoutUrl: string | null = null;

      if (input.createSubscription) {
        const { priceId } = await ensureProducts();
        // Create a Checkout Session so the client can enter payment details
        const session = await stripe.checkout.sessions.create({
          customer: customer.id,
          mode: "subscription",
          line_items: [{ price: priceId, quantity: 1 }],
          success_url: `${process.env.VITE_APP_URL ?? "https://astersports.io"}/admin/billing?success=true`,
          cancel_url: `${process.env.VITE_APP_URL ?? "https://astersports.io"}/admin/billing?canceled=true`,
        });
        checkoutUrl = session.url;
        subscriptionStatus = "pending_checkout";
      }

      // Store in our database
      await db.insert(billingClients).values({
        name: input.name,
        email: input.email,
        stripeCustomerId: customer.id,
        stripeSubscriptionId: subscriptionId,
        subscriptionStatus,
        notes: input.notes ?? null,
      });

      return {
        customerId: customer.id,
        subscriptionId,
        subscriptionStatus,
        checkoutUrl,
      };
    }),

  /**
   * Create a subscription for an existing client.
   */
  createSubscription: ownerProcedure
    .input(
      z.object({
        clientId: z.number(),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      const [client] = await db
        .select()
        .from(billingClients)
        .where(eq(billingClients.id, input.clientId))
        .limit(1);

      if (!client) throw new Error("Client not found");

      const { priceId } = await ensureProducts();

      // Create a Checkout Session so the client can enter payment details
      const session = await stripe.checkout.sessions.create({
        customer: client.stripeCustomerId,
        mode: "subscription",
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: `${process.env.VITE_APP_URL ?? "https://astersports.io"}/admin/billing?success=true`,
        cancel_url: `${process.env.VITE_APP_URL ?? "https://astersports.io"}/admin/billing?canceled=true`,
      });

      // Update DB to pending
      await db
        .update(billingClients)
        .set({
          subscriptionStatus: "pending_checkout",
        })
        .where(eq(billingClients.id, input.clientId));

      return {
        checkoutUrl: session.url,
        status: "pending_checkout",
      };
    }),

  /**
   * Generate a one-time payment link for a specific amount.
   */
  createPaymentLink: ownerProcedure
    .input(
      z.object({
        amount: z.number().min(100, "Minimum amount is $1.00 (100 cents)"),
        description: z.string().min(1, "Description is required"),
        clientId: z.number().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();

      // Create a one-time price
      const { productId } = await ensureProducts();

      const price = await stripe.prices.create({
        product: productId,
        unit_amount: input.amount,
        currency: "usd",
      });

      // Create payment link
      const paymentLink = await stripe.paymentLinks.create({
        line_items: [{ price: price.id, quantity: 1 }],
        metadata: {
          description: input.description,
          clientId: input.clientId?.toString() ?? "",
        },
      });

      return {
        url: paymentLink.url,
        id: paymentLink.id,
      };
    }),

  /**
   * Create a Stripe Customer Portal session for a client to manage their subscription.
   */
  createPortalSession: ownerProcedure
    .input(
      z.object({
        clientId: z.number(),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      const [client] = await db
        .select()
        .from(billingClients)
        .where(eq(billingClients.id, input.clientId))
        .limit(1);

      if (!client) throw new Error("Client not found");

      const session = await stripe.billingPortal.sessions.create({
        customer: client.stripeCustomerId,
        return_url: `${process.env.VITE_APP_URL ?? "https://astersports.io"}/admin/billing`,
      });

      return { url: session.url };
    }),

  /**
   * Get Stripe subscription details for a client.
   */
  getSubscriptionDetails: ownerProcedure
    .input(
      z.object({
        clientId: z.number(),
      })
    )
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      const [client] = await db
        .select()
        .from(billingClients)
        .where(eq(billingClients.id, input.clientId))
        .limit(1);

      if (!client) throw new Error("Client not found");

      if (!client.stripeSubscriptionId) {
        return { subscription: null, invoices: [] };
      }

      const subscription = await stripe.subscriptions.retrieve(
        client.stripeSubscriptionId
      );

      const invoices = await stripe.invoices.list({
        customer: client.stripeCustomerId,
        limit: 10,
      });

      return {
        subscription: {
          id: subscription.id,
          status: subscription.status,
          currentPeriodStart: (subscription as any).current_period_start ?? null,
          currentPeriodEnd: (subscription as any).current_period_end ?? null,
          cancelAtPeriodEnd: subscription.cancel_at_period_end,
        },
        invoices: invoices.data.map((inv) => ({
          id: inv.id,
          amountDue: inv.amount_due,
          amountPaid: inv.amount_paid,
          status: inv.status,
          created: inv.created,
          hostedInvoiceUrl: inv.hosted_invoice_url,
          invoicePdf: inv.invoice_pdf,
        })),
      };
    }),

  /**
   * Sync subscription status from Stripe for all clients.
   */
  syncAll: ownerProcedure.mutation(async () => {
    const db = await getDb();
    if (!db) throw new Error("Database not available");

    const clients = await db.select().from(billingClients);
    let updated = 0;

    for (const client of clients) {
      if (!client.stripeSubscriptionId) continue;

      try {
        const subscription = await stripe.subscriptions.retrieve(
          client.stripeSubscriptionId
        );

        if (subscription.status !== client.subscriptionStatus) {
          await db
            .update(billingClients)
            .set({ subscriptionStatus: subscription.status })
            .where(eq(billingClients.id, client.id));
          updated++;
        }
      } catch (err) {
        console.error(
          `[Billing] Failed to sync client ${client.id}:`,
          (err as Error).message
        );
      }
    }

    return { synced: clients.length, updated };
  }),
});
