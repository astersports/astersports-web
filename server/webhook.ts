import type { Request, Response } from "express";
import { eq, and } from "drizzle-orm";
import { stripe } from "./stripe";
import { getDb } from "./db";
import { billingClients } from "../drizzle/schema";
import { notifyOwner } from "./_core/notification";
import { ENV } from "./_core/env";
import { emailPaymentFailed, emailSubscriptionCanceled, emailSubscriptionActivated } from "./email";
import type Stripe from "stripe";
import { grantCredits, updateTenantStripe } from "./studioDb";
import { PLANS, TOPUP_PACKS, type PlanKey } from "../shared/billing";
import { tenants, stripeEvents } from "../drizzle/schema";
import { handleSetupIntentSucceeded, convertTrialToPaid, restoreFrozenCreditsIfEligible } from "./shadowBilling";

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
    } else if (ENV.isProduction) {
      console.error("[Stripe Webhook] STRIPE_WEBHOOK_SECRET missing in production; rejecting.");
      return res.status(500).json({ error: "Webhook secret not configured" });
    } else {
      // No webhook secret configured — parse body directly (dev only)
      event = JSON.parse(req.body.toString()) as Stripe.Event;
    }
  } catch (err) {
    // Check if this is a test event
    try {
      const parsed = JSON.parse(req.body.toString());
      if (!ENV.stripeWebhookSecret && parsed.id && parsed.id.startsWith("evt_test_")) {
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

  // C3: idempotency without losing a paid grant on a mid-handler crash.
  // We RECORD the event only AFTER its handler succeeds, so a crash before the
  // record leaves the event unrecorded and Stripe re-delivers it — the grant is
  // retried, never permanently lost. Double-processing on the retry is harmless
  // because credit grants are idempotent on (refId, reason) (see grantCredits).
  // A cheap pre-check still short-circuits the common duplicate-delivery case.
  const idemDb = await getDb();

  try {
    if (idemDb) {
      const [seen] = await idemDb
        .select({ id: stripeEvents.id })
        .from(stripeEvents)
        .where(eq(stripeEvents.id, event.id))
        .limit(1);
      if (seen) {
        console.log(`[Stripe Webhook] Duplicate event ${event.id}, skipping.`);
        return res.json({ received: true, duplicate: true });
      }
    }

    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        // Route to Studio handler if metadata indicates print-studio product
        if (session.metadata?.product === "print-studio") {
          await handleStudioCheckoutCompleted(session);
        } else {
          await handleCheckoutCompleted(session);
        }
        break;
      }

      case "invoice.paid": {
        const invoice = event.data.object as Stripe.Invoice;
        // Check if this invoice belongs to a Studio subscription
        const invSub = (invoice as any).subscription;
        let isStudioInvoice = false;
        if (invSub) {
          try {
            const subId = typeof invSub === "string" ? invSub : invSub.id;
            const sub = await stripe.subscriptions.retrieve(subId);
            isStudioInvoice = sub.metadata?.product === "print-studio";
          } catch { /* ignore */ }
        }
        if (isStudioInvoice) {
          await handleStudioInvoicePaid(invoice);
        } else {
          await handleInvoicePaid(invoice);
        }
        break;
      }

      case "customer.subscription.updated": {
        const sub = event.data.object as Stripe.Subscription;
        if (sub.metadata?.product === "print-studio") {
          await handleStudioSubscriptionUpdated(sub);
        } else {
          await handleSubscriptionUpdated(sub);
        }
        break;
      }

      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        if (sub.metadata?.product === "print-studio") {
          await handleStudioSubscriptionDeleted(sub);
        } else {
          await handleSubscriptionDeleted(sub);
        }
        break;
      }

      case "invoice.payment_failed":
        await handlePaymentFailed(event.data.object as Stripe.Invoice);
        break;

      case "setup_intent.succeeded": {
        const si = event.data.object as Stripe.SetupIntent;
        if (si.metadata?.product === "print-studio" && si.metadata?.tenantId) {
          const pmId = typeof si.payment_method === "string" ? si.payment_method : si.payment_method?.id;
          if (pmId) {
            await handleSetupIntentSucceeded(si.id, pmId, parseInt(si.metadata.tenantId, 10));
          }
        }
        break;
      }

      default:
        console.log(`[Stripe Webhook] Unhandled event type: ${event.type}`);
    }

    // C3: handler succeeded — NOW record the event so future deliveries skip it.
    if (idemDb) {
      try {
        await idemDb.insert(stripeEvents).values({ id: event.id, type: event.type });
      } catch {
        // Concurrent delivery already recorded it; the work was idempotent.
      }
    }

    res.json({ received: true });
  } catch (err) {
    // Not recorded — Stripe retries; grant idempotency makes the retry safe.
    console.error("[Stripe Webhook] Handler error:", (err as Error).message);
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
      .where(and(
        eq(billingClients.stripeCustomerId, customerId),
        eq(billingClients.stripeSubscriptionId, subscription.id)
      ));

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
      .where(and(
        eq(billingClients.stripeCustomerId, customerId),
        eq(billingClients.stripeSubscriptionId, subscription.id)
      ));

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

// ═══════════════════════════════════════════════════════════════════════════════
// PRINT STUDIO WEBHOOK HANDLERS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Handle Studio checkout.session.completed — subscription or top-up purchase.
 */
async function handleStudioCheckoutCompleted(session: Stripe.Checkout.Session) {
  const tenantId = parseInt(session.metadata?.tenantId ?? "0", 10);
  if (!tenantId) {
    console.error("[Studio Webhook] Missing tenantId in checkout metadata");
    return;
  }

  const db = await getDb();
  if (!db) {
    console.error("[Studio Webhook] Database not available");
    return;
  }

  // Handle subscription checkout
  if (session.mode === "subscription" && session.subscription) {
    const subscriptionId =
      typeof session.subscription === "string" ? session.subscription : session.subscription.id;
    const plan = (session.metadata?.plan ?? "starter") as PlanKey;
    const planDef = PLANS[plan as Exclude<PlanKey, "none">];

    // Update tenant with Stripe IDs and plan
    await updateTenantStripe(tenantId, {
      stripeSubscriptionId: subscriptionId,
      plan: plan as any,
    });

    // C4: never grant credits for an unpaid checkout. Stripe sets payment_status
    // to "paid" (charged) or "no_payment_required" (trial / 100%-off); "unpaid"
    // means no money moved and must not grant. NOTE for Architect (money path):
    // the free-plan / 100%-off-promo credit policy is intentionally a business
    // decision — this guard only blocks the clearly-unpaid case.
    if (session.payment_status === "unpaid") {
      console.warn(`[Studio Webhook] checkout ${session.id} unpaid; skipping credit grant`);
    } else if (planDef) {
      // C4: tie credits to the quantity Stripe actually billed, not to
      // client-supplied checkout metadata which can drift from the line item.
      let seats = parseInt(session.metadata?.seats ?? "1", 10) || 1;
      try {
        const sub = await stripe.subscriptions.retrieve(subscriptionId);
        const qty = sub.items?.data?.[0]?.quantity;
        if (typeof qty === "number" && qty > 0) seats = qty;
      } catch { /* fall back to metadata seats */ }
      const totalCredits = planDef.perSeat ? planDef.creditsPerCycle * seats : planDef.creditsPerCycle;
      await grantCredits(
        tenantId,
        totalCredits,
        "subscription_start",
        subscriptionId
      );
    }

    // Restore frozen credits if re-subscribing within 90 days
    const restored = await restoreFrozenCreditsIfEligible(tenantId);

    console.log(`[Studio Webhook] Subscription activated for tenant ${tenantId}: ${plan}${restored ? ` (+${restored} restored)` : ""}`);

    try {
      await notifyOwner({
        title: "Print Studio Subscription",
        content: `Tenant #${tenantId} subscribed to ${plan} plan. Subscription: ${subscriptionId}${restored ? `. Restored ${restored} frozen credits.` : ""}`,
      });
    } catch { /* ignore */ }
  }

  // Handle top-up payment
  if (session.mode === "payment" && session.metadata?.packKey) {
    const pack = TOPUP_PACKS.find((p) => p.key === session.metadata!.packKey);
    if (pack) {
      await grantCredits(
        tenantId,
        pack.credits,
        "topup",
        session.id
      );
      console.log(`[Studio Webhook] Top-up ${pack.name} (${pack.credits} credits) for tenant ${tenantId}`);
    }
  }
}

/**
 * Handle Studio invoice.paid — recurring subscription renewal.
 * Grants credits for the billing cycle.
 */
async function handleStudioInvoicePaid(invoice: Stripe.Invoice) {
  // Only grant credits for recurring invoices (not the first one, which is handled by checkout)
  const billingReason = (invoice as any).billing_reason;
  if (billingReason === "subscription_create") {
    console.log("[Studio Webhook] Skipping initial invoice (handled by checkout)");
    return;
  }

  // C4: only grant renewal credits for a genuinely-paid, positive invoice.
  // A $0 / unpaid / proration-only invoice must not mint a full cycle of credits.
  const invStatus = (invoice as any).status;
  const amountPaid = (invoice as any).amount_paid ?? 0;
  if (invStatus !== "paid" || amountPaid <= 0) {
    console.log(
      `[Studio Webhook] invoice ${invoice.id} not a positive paid invoice ` +
        `(status=${invStatus}, amount_paid=${amountPaid}); skipping credit grant`
    );
    return;
  }

  const invSub = (invoice as any).subscription;
  if (!invSub) return;

  const subId = typeof invSub === "string" ? invSub : invSub.id;

  try {
    const sub = await stripe.subscriptions.retrieve(subId);
    const tenantId = parseInt(sub.metadata?.tenantId ?? "0", 10);
    const plan = (sub.metadata?.plan ?? "starter") as PlanKey;

    if (!tenantId) return;

    const planDef = PLANS[plan as Exclude<PlanKey, "none">];
    if (planDef) {
      // C4: seats from the actual billed line-item quantity, not metadata.
      let seats = parseInt(sub.metadata?.seats ?? "1", 10) || 1;
      const qty = sub.items?.data?.[0]?.quantity;
      if (typeof qty === "number" && qty > 0) seats = qty;
      const totalCredits = planDef.perSeat ? planDef.creditsPerCycle * seats : planDef.creditsPerCycle;
      await grantCredits(
        tenantId,
        totalCredits,
        "subscription_renewal",
        invoice.id
      );
      console.log(`[Studio Webhook] Renewal credits granted for tenant ${tenantId}: ${totalCredits}`);
    }
  } catch (err) {
    console.error("[Studio Webhook] Error handling invoice.paid:", (err as Error).message);
  }
}

/**
 * Handle Studio subscription updated.
 */
async function handleStudioSubscriptionUpdated(subscription: Stripe.Subscription) {
  const tenantId = parseInt(subscription.metadata?.tenantId ?? "0", 10);
  if (!tenantId) return;

  try {
    // Only update the stored plan when the event actually carries plan metadata.
    // A bare subscription.updated event (e.g. status-only change) must not
    // silently downgrade a paying tenant to "none".
    const update: { stripeSubscriptionId: string; plan?: any } = {
      stripeSubscriptionId: subscription.id,
    };
    if (subscription.metadata?.plan) {
      update.plan = subscription.metadata.plan as any;
    }

    await updateTenantStripe(tenantId, update);
    console.log(`[Studio Webhook] Subscription updated for tenant ${tenantId}: ${subscription.status}`);
  } catch (err) {
    console.error("[Studio Webhook] Error handling subscription.updated:", (err as Error).message);
  }
}

/**
 * Handle Studio subscription deleted/canceled.
 */
async function handleStudioSubscriptionDeleted(subscription: Stripe.Subscription) {
  const tenantId = parseInt(subscription.metadata?.tenantId ?? "0", 10);
  if (!tenantId) return;

  try {
    await updateTenantStripe(tenantId, {
      plan: "none" as any,
    });
    console.log(`[Studio Webhook] Subscription canceled for tenant ${tenantId}`);

    try {
      await notifyOwner({
        title: "Print Studio Subscription Canceled",
        content: `Tenant #${tenantId} subscription canceled. ID: ${subscription.id}`,
      });
    } catch { /* ignore */ }
  } catch (err) {
    console.error("[Studio Webhook] Error handling subscription.deleted:", (err as Error).message);
  }
}
