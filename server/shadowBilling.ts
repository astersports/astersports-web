/**
 * Shadow Billing — Reverse-Trial Flow
 *
 * Org-level billing: one credit card per tenant (firm/individual).
 * All members sharing the tenant's domain roll up to the same card.
 *
 * Flow:
 * 1. Day 0: Owner sets up card via Stripe SetupIntent → stores PaymentMethod on tenant
 * 2. Day 4: Reminder notification (handled by trialReminders.ts)
 * 3. Day 6: Final warning notification (handled by trialReminders.ts)
 * 4. Day 7: Auto-charge via PaymentIntent using stored PaymentMethod → convert to paid plan
 *
 * On cancel before Day 7: credits freeze (90-day expiry), card is not charged.
 * On re-subscribe within 90 days: frozen credits restore.
 */

import { stripe } from "./stripe";
import { getDb } from "./db";
import { tenants } from "../drizzle/schema";
import { eq, and, isNotNull, isNull, lte } from "drizzle-orm";
import { grantCredits } from "./studioDb";
import { notifyOwner } from "./_core/notification";
import { TRIAL_DURATION_DAYS, PLANS, type PlanKey } from "../shared/billing";
import { log } from "./serverLog";

// ═══════════════════════════════════════════════════════════════════════════════
// SETUP INTENT — Collect card on file for the org
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Create a Stripe SetupIntent for the tenant to collect card on file.
 * If the tenant doesn't have a Stripe Customer yet, one is created.
 * Returns the client_secret for the frontend to confirm the SetupIntent.
 */
export async function createOrgSetupIntent(
  tenantId: number,
  tenantName: string,
  ownerEmail: string
): Promise<{ clientSecret: string; setupIntentId: string }> {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");

  // Get or create Stripe Customer for this tenant
  const [tenant] = await db
    .select({
      stripeCustomerId: tenants.stripeCustomerId,
    })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);

  let customerId = tenant?.stripeCustomerId;

  if (!customerId) {
    const customer = await stripe.customers.create({
      name: tenantName,
      email: ownerEmail,
      metadata: {
        tenantId: tenantId.toString(),
        product: "print-studio",
      },
    });
    customerId = customer.id;

    await db
      .update(tenants)
      .set({ stripeCustomerId: customerId })
      .where(eq(tenants.id, tenantId));
  }

  // Create SetupIntent
  const setupIntent = await stripe.setupIntents.create({
    customer: customerId,
    payment_method_types: ["card"],
    metadata: {
      tenantId: tenantId.toString(),
      product: "print-studio",
      purpose: "trial-card-on-file",
    },
  });

  // Store the SetupIntent ID on the tenant
  await db
    .update(tenants)
    .set({ stripeSetupIntentId: setupIntent.id })
    .where(eq(tenants.id, tenantId));

  log.info("shadowBilling", "SetupIntent created for org", {
    tenantId,
    metadata: { setupIntentId: setupIntent.id },
  });

  return {
    clientSecret: setupIntent.client_secret!,
    setupIntentId: setupIntent.id,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// SETUP INTENT SUCCEEDED — Store PaymentMethod on tenant
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Called from webhook when setup_intent.succeeded fires.
 * Stores the PaymentMethod ID on the tenant for Day 7 auto-charge.
 */
export async function handleSetupIntentSucceeded(
  setupIntentId: string,
  paymentMethodId: string,
  tenantId: number
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");

  await db
    .update(tenants)
    .set({ stripePaymentMethodId: paymentMethodId })
    .where(eq(tenants.id, tenantId));

  log.info("shadowBilling", "PaymentMethod stored for org (card on file)", {
    tenantId,
    metadata: { setupIntentId, paymentMethodId },
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// DAY 7 AUTO-CHARGE — Heartbeat cron job
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Find all tenants at Day 7 (trial expired) that have a stored PaymentMethod
 * but haven't been converted yet. Charge them for the Starter plan.
 *
 * Called by the /api/scheduled/trial-autocharge Heartbeat cron (daily).
 */
export async function processTrialAutoCharges(): Promise<{
  processed: number;
  charged: number;
  failed: number;
  errors: string[];
}> {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");

  const now = new Date();
  // Day 7 cutoff: tenants whose trial started >= 7 days ago
  const day7Cutoff = new Date(now.getTime() - TRIAL_DURATION_DAYS * 24 * 60 * 60 * 1000);

  // Find tenants that:
  // 1. Have a trial start date
  // 2. Trial started >= 7 days ago (Day 7+)
  // 3. Have a stored PaymentMethod (card on file)
  // 4. Haven't been converted yet (trialConvertedAt is null)
  // 5. Still on "none" plan (not already subscribed)
  const eligibleTenants = await db
    .select({
      id: tenants.id,
      name: tenants.name,
      stripeCustomerId: tenants.stripeCustomerId,
      stripePaymentMethodId: tenants.stripePaymentMethodId,
      creditBalance: tenants.creditBalance,
    })
    .from(tenants)
    .where(
      and(
        isNotNull(tenants.trialStartedAt),
        lte(tenants.trialStartedAt, day7Cutoff),
        isNotNull(tenants.stripePaymentMethodId),
        isNull(tenants.trialConvertedAt),
        eq(tenants.plan, "none")
      )
    );

  const result = { processed: eligibleTenants.length, charged: 0, failed: 0, errors: [] as string[] };

  for (const tenant of eligibleTenants) {
    try {
      if (!tenant.stripeCustomerId || !tenant.stripePaymentMethodId) {
        result.errors.push(`Tenant ${tenant.id}: missing Stripe IDs`);
        result.failed++;
        continue;
      }

      // Charge for Starter plan ($39)
      const plan = PLANS.starter;
      const amountCents = plan.priceMonthly * 100; // $39.00 = 3900 cents

      const paymentIntent = await stripe.paymentIntents.create({
        amount: amountCents,
        currency: "usd",
        customer: tenant.stripeCustomerId,
        payment_method: tenant.stripePaymentMethodId,
        off_session: true,
        confirm: true,
        metadata: {
          tenantId: tenant.id.toString(),
          product: "print-studio",
          purpose: "trial-conversion",
          plan: "starter",
        },
        description: `Print Studio — Starter plan activation for ${tenant.name}`,
      });

      if (paymentIntent.status === "succeeded") {
        // Convert the trial: set plan, grant credits, mark converted
        await convertTrialToPaid(tenant.id, "starter", paymentIntent.id);
        result.charged++;

        log.info("shadowBilling", "Trial auto-charge succeeded", {
          tenantId: tenant.id,
          metadata: { paymentIntentId: paymentIntent.id, amount: amountCents },
        });
      } else {
        // Payment requires additional action (3DS, etc.) — mark as failed
        result.errors.push(
          `Tenant ${tenant.id}: PaymentIntent status=${paymentIntent.status} (may need 3DS)`
        );
        result.failed++;

        log.warn("shadowBilling", "Trial auto-charge requires action", {
          tenantId: tenant.id,
          metadata: { paymentIntentId: paymentIntent.id, status: paymentIntent.status },
        });
      }
    } catch (err) {
      const msg = (err as Error).message;
      result.errors.push(`Tenant ${tenant.id}: ${msg}`);
      result.failed++;

      log.error("shadowBilling", "Trial auto-charge failed", {
        tenantId: tenant.id,
        metadata: { error: msg },
      });

      // Notify owner about the failure
      try {
        await notifyOwner({
          title: "Trial Auto-Charge Failed",
          content: `Failed to charge tenant "${tenant.name}" (ID: ${tenant.id}) for Starter plan. Error: ${msg}`,
        });
      } catch { /* ignore notification failure */ }
    }
  }

  if (result.charged > 0) {
    try {
      await notifyOwner({
        title: "Trial Conversions",
        content: `${result.charged} tenant(s) auto-charged for Starter plan. ${result.failed} failed.`,
      });
    } catch { /* ignore */ }
  }

  return result;
}

// ═══════════════════════════════════════════════════════════════════════════════
// TRIAL CONVERSION — Clear trial state, activate plan, grant credits
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Convert a tenant from trial to a paid plan.
 * Clears trial state, sets plan, grants initial credits.
 */
export async function convertTrialToPaid(
  tenantId: number,
  plan: PlanKey,
  referenceId: string
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");

  const planDef = PLANS[plan as Exclude<PlanKey, "none">];
  if (!planDef) throw new Error(`Invalid plan: ${plan}`);

  // Update tenant: set plan, mark trial as converted
  await db
    .update(tenants)
    .set({
      plan: plan as any,
      trialConvertedAt: new Date(),
    })
    .where(eq(tenants.id, tenantId));

  // Grant initial plan credits
  await grantCredits(tenantId, planDef.creditsPerCycle, "subscription_start", referenceId);

  log.info("shadowBilling", "Trial converted to paid plan", {
    tenantId,
    metadata: { plan, creditsGranted: planDef.creditsPerCycle, referenceId },
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// TRIAL CANCEL — Freeze credits
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Cancel a trial: freeze remaining credits (90-day expiry), clear card on file.
 * Called when owner explicitly cancels before Day 7.
 */
export async function cancelTrialAndFreezeCredits(tenantId: number): Promise<{
  frozenCredits: number;
}> {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");

  // Get current balance
  const [tenant] = await db
    .select({ creditBalance: tenants.creditBalance })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);

  const frozenCredits = tenant?.creditBalance ?? 0;

  // Freeze: zero out balance, store frozen amount + timestamp
  await db
    .update(tenants)
    .set({
      creditBalance: 0,
      trialFrozenCredits: frozenCredits,
      trialFrozenAt: new Date(),
      trialStartedAt: null,
      stripePaymentMethodId: null,
      stripeSetupIntentId: null,
    })
    .where(eq(tenants.id, tenantId));

  log.info("shadowBilling", "Trial canceled, credits frozen", {
    tenantId,
    metadata: { frozenCredits },
  });

  return { frozenCredits };
}

// ═══════════════════════════════════════════════════════════════════════════════
// RESTORE FROZEN CREDITS — On re-subscribe within 90 days
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Restore frozen credits if the tenant re-subscribes within 90 days.
 * Called during subscription activation.
 */
export async function restoreFrozenCreditsIfEligible(tenantId: number): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");

  const [tenant] = await db
    .select({
      trialFrozenCredits: tenants.trialFrozenCredits,
      trialFrozenAt: tenants.trialFrozenAt,
    })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);

  if (!tenant || !tenant.trialFrozenCredits || !tenant.trialFrozenAt) {
    return 0;
  }

  // Check 90-day window
  const frozenAt = new Date(tenant.trialFrozenAt).getTime();
  const ninetyDaysMs = 90 * 24 * 60 * 60 * 1000;
  const now = Date.now();

  if (now - frozenAt > ninetyDaysMs) {
    // Expired — clear frozen state, don't restore
    await db
      .update(tenants)
      .set({ trialFrozenCredits: 0, trialFrozenAt: null })
      .where(eq(tenants.id, tenantId));

    log.info("shadowBilling", "Frozen credits expired (>90 days)", { tenantId });
    return 0;
  }

  // Restore: add frozen credits back to balance
  const restored = tenant.trialFrozenCredits;
  // refId is unique per freeze EVENT (includes frozenAt), so a 2nd legitimate
  // freeze→restore cycle isn't silently dropped by grantCredits' (refId,reason)
  // idempotency — while a retry of the same restore stays idempotent.
  await grantCredits(tenantId, restored, "frozen_credits_restored", `restore-${tenantId}-${frozenAt}`);

  // Clear frozen state
  await db
    .update(tenants)
    .set({ trialFrozenCredits: 0, trialFrozenAt: null })
    .where(eq(tenants.id, tenantId));

  log.info("shadowBilling", "Frozen credits restored", {
    tenantId,
    metadata: { restored },
  });
  return restored;
}
