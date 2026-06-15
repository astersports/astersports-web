import type { Request, Response } from "express";
import { eq } from "drizzle-orm";
import { stripe } from "./stripe";
import { getDb } from "./db";
import { billingClients } from "../drizzle/schema";
import { notifyOwner } from "./_core/notification";
import { ENV } from "./_core/env";
import type Stripe from "stripe";

/**
 * Stripe webhook handler.
 * MUST be mounted with express.raw({ type: 'application/json' }) body parser.
 */
export async function handleStripeWebhook(req: Request, res: Response) {
  const sig = req.headers["stripe-signature"] as string;

  // Handle test events from Stripe dashboard
  // Test events have IDs starting with 'evt_test_' or may not have valid signatures in test mode
  let event: Stripe.Event;

  try {
    if (ENV.stripeWebhookSecret) {
      event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        ENV.stripeWebhookSecret
      );
    } else {
      // No webhook secret configured — parse body directly (dev only)
      event = JSON.parse(req.body.toString()) as Stripe.Event;
    }
  } catch (err) {
    // Check if this is a test event
    try {
      const parsed = JSON.parse(req.body.toString());
      if (parsed.id && parsed.id.startsWith("evt_test_")) {
        console.log("[Stripe Webhook] Test event received:", parsed.id);
        return res.json({ verified: true });
      }
    } catch {
      // ignore parse errors
    }

    console.error("[Stripe Webhook] Signature verification failed:", (err as Error).message);
    return res.status(400).json({ error: "Webhook signature verification failed" });
  }

  console.log(`[Stripe Webhook] Event received: ${event.type} (${event.id})`);

  try {
    switch (event.type) {
      case "checkout.session.completed":
        await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
        break;

      case "invoice.paid":
        await handleInvoicePaid(event.data.object as Stripe.Invoice);
        break;

      case "customer.subscription.updated":
        await handleSubscriptionUpdated(event.data.object as Stripe.Subscription);
        break;

      case "customer.subscription.deleted":
        await handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
        break;

      case "invoice.payment_failed":
        await handlePaymentFailed(event.data.object as Stripe.Invoice);
        break;

      default:
        console.log(`[Stripe Webhook] Unhandled event type: ${event.type}`);
    }

    res.json({ received: true });
  } catch (err) {
    console.error("[Stripe Webhook] Handler error:", (err as Error).message);
    res.status(500).json({ error: "Webhook handler failed" });
  }
}

/**
 * Handle checkout.session.completed — a client completed a checkout
 */
async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  if (!session.customer || !session.subscription) return;

  const customerId = typeof session.customer === "string" ? session.customer : session.customer.id;
  const subscriptionId = typeof session.subscription === "string" ? session.subscription : session.subscription.id;

  const db = await getDb();
  if (!db) return;

  await db
    .update(billingClients)
    .set({
      stripeSubscriptionId: subscriptionId,
      subscriptionStatus: "active",
    })
    .where(eq(billingClients.stripeCustomerId, customerId));

  await notifyOwner({
    title: "New Subscription Activated",
    content: `Customer ${customerId} completed checkout. Subscription: ${subscriptionId}`,
  });
}

/**
 * Handle invoice.paid — successful payment
 */
async function handleInvoicePaid(invoice: Stripe.Invoice) {
  if (!invoice.customer) return;

  const customerId = typeof invoice.customer === "string" ? invoice.customer : invoice.customer.id;

  const db = await getDb();
  if (!db) return;

  // Update subscription status to active on successful payment
  const invoiceSub = (invoice as any).subscription;
  if (invoiceSub) {
    await db
      .update(billingClients)
      .set({ subscriptionStatus: "active" })
      .where(eq(billingClients.stripeCustomerId, customerId));
  }

  console.log(`[Stripe Webhook] Invoice paid: ${invoice.id} for customer ${customerId}`);
}

/**
 * Handle customer.subscription.updated — status change
 */
async function handleSubscriptionUpdated(subscription: Stripe.Subscription) {
  const customerId = typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;

  const db = await getDb();
  if (!db) return;

  await db
    .update(billingClients)
    .set({
      subscriptionStatus: subscription.status,
      stripeSubscriptionId: subscription.id,
    })
    .where(eq(billingClients.stripeCustomerId, customerId));

  // Notify on concerning status changes
  if (["past_due", "unpaid", "canceled"].includes(subscription.status)) {
    await notifyOwner({
      title: `Subscription ${subscription.status}`,
      content: `Customer ${customerId} subscription is now ${subscription.status}. Subscription ID: ${subscription.id}`,
    });
  }
}

/**
 * Handle customer.subscription.deleted — subscription canceled
 */
async function handleSubscriptionDeleted(subscription: Stripe.Subscription) {
  const customerId = typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;

  const db = await getDb();
  if (!db) return;

  await db
    .update(billingClients)
    .set({
      subscriptionStatus: "canceled",
    })
    .where(eq(billingClients.stripeCustomerId, customerId));

  await notifyOwner({
    title: "Subscription Canceled",
    content: `Customer ${customerId} subscription has been canceled. Subscription ID: ${subscription.id}`,
  });
}

/**
 * Handle invoice.payment_failed — payment attempt failed
 */
async function handlePaymentFailed(invoice: Stripe.Invoice) {
  if (!invoice.customer) return;

  const customerId = typeof invoice.customer === "string" ? invoice.customer : invoice.customer.id;

  await notifyOwner({
    title: "Payment Failed",
    content: `Payment failed for customer ${customerId}. Invoice: ${invoice.id}. Amount: $${((invoice.amount_due ?? 0) / 100).toFixed(2)}`,
  });
}
