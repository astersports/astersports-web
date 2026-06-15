import type { Request, Response } from "express";
import { eq } from "drizzle-orm";
import { stripe } from "./stripe";
import { getDb } from "./db";
import { billingClients } from "../drizzle/schema";
import { notifyOwner } from "./_core/notification";
import { ENV } from "./_core/env";
import { emailPaymentFailed, emailSubscriptionCanceled, emailSubscriptionActivated } from "./email";
import type Stripe from "stripe";

/**
 * Stripe webhook handler.
 * MUST be mounted with express.raw({ type: 'application/json' }) body parser.
 */
export async function handleStripeWebhook(req: Request, res: Response) {
  const sig = req.headers["stripe-signature"] as string;

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
    console.error("[Stripe Webhook] Handler error:", (err as Error).message, (err as Error).stack);
    res.status(500).json({ error: "Webhook handler failed" });
  }
}

/**
 * Helper: look up client name/email from Stripe customer ID.
 * Returns null if no matching billing_clients row exists.
 */
async function getClientInfo(customerId: string): Promise<{ name: string; email: string } | null> {
  try {
    const db = await getDb();
    if (!db) return null;

    const [client] = await db
      .select({ name: billingClients.name, email: billingClients.email })
      .from(billingClients)
      .where(eq(billingClients.stripeCustomerId, customerId))
      .limit(1);

    return client ?? null;
  } catch (err) {
    console.error("[Stripe Webhook] Error looking up client:", (err as Error).message);
    return null;
  }
}

/**
 * Helper: create a billing_clients row from Stripe customer data.
 * Used when a checkout completes for a customer not yet in our DB
 * (e.g., payment link used without the "Add Client" flow).
 */
async function autoCreateClient(customerId: string, subscriptionId: string): Promise<{ name: string; email: string }> {
  console.log(`[Stripe Webhook] Auto-creating client for Stripe customer ${customerId}`);

  // Fetch customer details from Stripe
  const customer = await stripe.customers.retrieve(customerId);

  if (customer.deleted) {
    console.warn(`[Stripe Webhook] Customer ${customerId} is deleted in Stripe`);
    return { name: "Deleted Customer", email: "" };
  }

  const name = customer.name || customer.email || "Unknown Client";
  const email = customer.email || "";

  const db = await getDb();
  if (!db) {
    console.error("[Stripe Webhook] Cannot auto-create client: database not available");
    return { name, email };
  }

  try {
    await db.insert(billingClients).values({
      name,
      email,
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscriptionId,
      subscriptionStatus: "active",
    });
    console.log(`[Stripe Webhook] Auto-created client: ${name} (${email})`);
  } catch (err) {
    // Could be a duplicate key error if there's a race condition
    console.error("[Stripe Webhook] Failed to auto-create client:", (err as Error).message);
  }

  return { name, email };
}

/**
 * Handle checkout.session.completed — a client completed a checkout.
 * Handles both cases:
 * 1. Client already exists in billing_clients (created via Add Client flow)
 * 2. Client does NOT exist (e.g., payment link used directly) — auto-creates the record
 */
async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  console.log(`[Stripe Webhook] Processing checkout.session.completed: ${session.id}`);

  if (!session.customer || !session.subscription) {
    console.log("[Stripe Webhook] Checkout session missing customer or subscription, skipping");
    return;
  }

  const customerId = typeof session.customer === "string" ? session.customer : session.customer.id;
  const subscriptionId = typeof session.subscription === "string" ? session.subscription : session.subscription.id;

  console.log(`[Stripe Webhook] Customer: ${customerId}, Subscription: ${subscriptionId}`);

  // Step 1: Try to update existing client record
  const db = await getDb();
  if (!db) {
    console.error("[Stripe Webhook] Database not available, cannot process checkout");
    return;
  }

  let client: { name: string; email: string } | null = null;

  try {
    const result = await db
      .update(billingClients)
      .set({
        stripeSubscriptionId: subscriptionId,
        subscriptionStatus: "active",
      })
      .where(eq(billingClients.stripeCustomerId, customerId));

    // mysql2 returns [ResultSetHeader, ...] where ResultSetHeader has affectedRows
    const affectedRows = (result as any)?.[0]?.affectedRows ?? 0;
    console.log(`[Stripe Webhook] DB update affected ${affectedRows} row(s)`);

    if (affectedRows === 0) {
      // No existing client — auto-create from Stripe customer data
      console.log(`[Stripe Webhook] No existing client found for ${customerId}, auto-creating...`);
      client = await autoCreateClient(customerId, subscriptionId);
    } else {
      // Existing client updated — fetch their info
      client = await getClientInfo(customerId);
    }
  } catch (err) {
    console.error("[Stripe Webhook] DB update failed:", (err as Error).message);
    // Still try to get client info for notifications
    client = await getClientInfo(customerId);
    if (!client) {
      client = await autoCreateClient(customerId, subscriptionId);
    }
  }

  const clientName = client?.name ?? "Unknown";
  const clientEmail = client?.email ?? "";

  // Step 2: Send in-app notification (wrapped in try/catch to prevent TRPCError from crashing)
  try {
    const notified = await notifyOwner({
      title: "New Subscription Activated",
      content: `${clientName} (${clientEmail}) completed checkout. Subscription: ${subscriptionId}`,
    });
    console.log(`[Stripe Webhook] Owner notification sent: ${notified}`);
  } catch (err) {
    console.error("[Stripe Webhook] Failed to notify owner:", (err as Error).message);
  }

  // Step 3: Send email notification
  try {
    const emailed = await emailSubscriptionActivated({
      clientName,
      clientEmail,
      subscriptionId,
    });
    console.log(`[Stripe Webhook] Activation email sent: ${emailed}`);
  } catch (err) {
    console.error("[Stripe Webhook] Failed to send activation email:", (err as Error).message);
  }

  console.log(`[Stripe Webhook] checkout.session.completed processing complete`);
}

/**
 * Handle invoice.paid — successful payment
 */
async function handleInvoicePaid(invoice: Stripe.Invoice) {
  if (!invoice.customer) {
    console.log("[Stripe Webhook] Invoice missing customer, skipping");
    return;
  }

  const customerId = typeof invoice.customer === "string" ? invoice.customer : invoice.customer.id;

  try {
    const db = await getDb();
    if (!db) {
      console.error("[Stripe Webhook] Database not available for invoice.paid");
      return;
    }

    // Update subscription status to active on successful payment
    const invoiceSub = (invoice as any).subscription;
    if (invoiceSub) {
      await db
        .update(billingClients)
        .set({ subscriptionStatus: "active" })
        .where(eq(billingClients.stripeCustomerId, customerId));
    }

    console.log(`[Stripe Webhook] Invoice paid: ${invoice.id} for customer ${customerId}`);
  } catch (err) {
    console.error("[Stripe Webhook] Error handling invoice.paid:", (err as Error).message);
  }
}

/**
 * Handle customer.subscription.updated — status change
 */
async function handleSubscriptionUpdated(subscription: Stripe.Subscription) {
  const customerId = typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;

  try {
    const db = await getDb();
    if (!db) {
      console.error("[Stripe Webhook] Database not available for subscription.updated");
      return;
    }

    await db
      .update(billingClients)
      .set({
        subscriptionStatus: subscription.status,
        stripeSubscriptionId: subscription.id,
      })
      .where(eq(billingClients.stripeCustomerId, customerId));

    console.log(`[Stripe Webhook] Subscription updated: ${subscription.id} → ${subscription.status}`);

    // Notify on concerning status changes
    if (["past_due", "unpaid", "canceled"].includes(subscription.status)) {
      const client = await getClientInfo(customerId);
      const clientName = client?.name ?? "Unknown";
      const clientEmail = client?.email ?? "";

      try {
        await notifyOwner({
          title: `Subscription ${subscription.status}`,
          content: `${clientName} (${clientEmail}) subscription is now ${subscription.status}. Subscription ID: ${subscription.id}`,
        });
      } catch (err) {
        console.error("[Stripe Webhook] Failed to notify owner about subscription update:", (err as Error).message);
      }
    }
  } catch (err) {
    console.error("[Stripe Webhook] Error handling subscription.updated:", (err as Error).message);
  }
}

/**
 * Handle customer.subscription.deleted — subscription canceled
 */
async function handleSubscriptionDeleted(subscription: Stripe.Subscription) {
  const customerId = typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;

  try {
    const db = await getDb();
    if (!db) {
      console.error("[Stripe Webhook] Database not available for subscription.deleted");
      return;
    }

    await db
      .update(billingClients)
      .set({
        subscriptionStatus: "canceled",
      })
      .where(eq(billingClients.stripeCustomerId, customerId));

    console.log(`[Stripe Webhook] Subscription deleted: ${subscription.id}`);

    const client = await getClientInfo(customerId);
    const clientName = client?.name ?? "Unknown";
    const clientEmail = client?.email ?? "";

    // In-app notification
    try {
      await notifyOwner({
        title: "Subscription Canceled",
        content: `${clientName} (${clientEmail}) subscription has been canceled. Subscription ID: ${subscription.id}`,
      });
    } catch (err) {
      console.error("[Stripe Webhook] Failed to notify owner about cancellation:", (err as Error).message);
    }

    // Email notification
    try {
      await emailSubscriptionCanceled({
        clientName,
        clientEmail,
        subscriptionId: subscription.id,
      });
    } catch (err) {
      console.error("[Stripe Webhook] Failed to send cancellation email:", (err as Error).message);
    }
  } catch (err) {
    console.error("[Stripe Webhook] Error handling subscription.deleted:", (err as Error).message);
  }
}

/**
 * Handle invoice.payment_failed — payment attempt failed
 */
async function handlePaymentFailed(invoice: Stripe.Invoice) {
  if (!invoice.customer) {
    console.log("[Stripe Webhook] Invoice missing customer for payment_failed, skipping");
    return;
  }

  const customerId = typeof invoice.customer === "string" ? invoice.customer : invoice.customer.id;
  const amount = ((invoice.amount_due ?? 0) / 100).toFixed(2);

  try {
    const client = await getClientInfo(customerId);
    const clientName = client?.name ?? "Unknown";
    const clientEmail = client?.email ?? "";

    // In-app notification
    try {
      await notifyOwner({
        title: "Payment Failed",
        content: `Payment failed for ${clientName} (${clientEmail}). Invoice: ${invoice.id}. Amount: $${amount}`,
      });
    } catch (err) {
      console.error("[Stripe Webhook] Failed to notify owner about payment failure:", (err as Error).message);
    }

    // Email notification
    try {
      await emailPaymentFailed({
        clientName,
        clientEmail,
        amount,
        invoiceId: invoice.id,
      });
    } catch (err) {
      console.error("[Stripe Webhook] Failed to send payment failure email:", (err as Error).message);
    }

    console.log(`[Stripe Webhook] Payment failed processed: ${invoice.id} for ${clientName}`);
  } catch (err) {
    console.error("[Stripe Webhook] Error handling payment_failed:", (err as Error).message);
  }
}
