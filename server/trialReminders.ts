/**
 * Trial Reminder Notifications — runs daily via Heartbeat cron.
 * Finds tenants in their trial at Day 4 or Day 6 and sends notifications.
 * Idempotent: uses a `trial_reminders_sent` table to avoid duplicate sends.
 */
import { getDb } from "./db";
import { tenants } from "../drizzle/schema";
import { getTrialStatus } from "./studioDb";
import { notifyOwner } from "./_core/notification";
import { and, isNotNull, sql } from "drizzle-orm";

export interface ReminderResult {
  tenantId: number;
  tenantName: string;
  trialDay: number;
  sent: boolean;
  error?: string;
}

/**
 * Check all active trial tenants and send Day 4 / Day 6 reminders.
 * Returns a summary of what was sent.
 */
export async function processTrialReminders(): Promise<{
  processed: number;
  sent: number;
  skipped: number;
  results: ReminderResult[];
}> {
  const db = await getDb();
  if (!db) {
    throw new Error("Database unavailable");
  }

  // Find all tenants currently in a trial (trialStartedAt is set)
  const trialTenants = await db
    .select()
    .from(tenants)
    .where(isNotNull(tenants.trialStartedAt));

  const results: ReminderResult[] = [];
  let sent = 0;
  let skipped = 0;

  for (const tenant of trialTenants) {
    const status = getTrialStatus(tenant);

    // Only process Day 4 and Day 6
    if (!status.inTrial || (status.trialDay !== 4 && status.trialDay !== 6)) {
      continue;
    }

    // Check idempotency — has this reminder already been sent?
    const alreadySent = await checkReminderSent(db, tenant.id, status.trialDay);
    if (alreadySent) {
      skipped++;
      results.push({
        tenantId: tenant.id,
        tenantName: tenant.name,
        trialDay: status.trialDay,
        sent: false,
        error: "already_sent",
      });
      continue;
    }

    // Build notification content
    const { title, content } = buildReminderContent(
      tenant.name,
      status.trialDay,
      status.daysRemaining,
      status.creditsUsed ?? 0,
      tenant.trialCredits
    );

    try {
      const success = await notifyOwner({ title, content });
      if (success) {
        // Mark as sent
        await markReminderSent(db, tenant.id, status.trialDay);
        sent++;
        results.push({
          tenantId: tenant.id,
          tenantName: tenant.name,
          trialDay: status.trialDay,
          sent: true,
        });
      } else {
        results.push({
          tenantId: tenant.id,
          tenantName: tenant.name,
          trialDay: status.trialDay,
          sent: false,
          error: "notification_service_unavailable",
        });
      }
    } catch (error) {
      results.push({
        tenantId: tenant.id,
        tenantName: tenant.name,
        trialDay: status.trialDay,
        sent: false,
        error: (error as Error).message,
      });
    }
  }

  return {
    processed: trialTenants.length,
    sent,
    skipped,
    results,
  };
}

/**
 * Build the notification title and content for a trial reminder.
 */
export function buildReminderContent(
  tenantName: string,
  trialDay: number,
  daysRemaining: number,
  creditsUsed: number,
  totalCredits: number
): { title: string; content: string } {
  if (trialDay === 4) {
    return {
      title: `Trial Halfway — ${tenantName}`,
      content: [
        `${tenantName}'s trial is halfway through (Day 4 of 7).`,
        ``,
        `Credits used: ${creditsUsed} of ${totalCredits} trial credits.`,
        `Days remaining: ${daysRemaining}.`,
        ``,
        `If no action is taken, the card on file will be charged on Day 7.`,
        `To cancel before the charge, visit the Billing page in Print Studio.`,
      ].join("\n"),
    };
  }

  // Day 6
  return {
    title: `Trial Ends Tomorrow — ${tenantName}`,
    content: [
      `${tenantName}'s trial ends tomorrow (Day 6 of 7).`,
      ``,
      `Credits used: ${creditsUsed} of ${totalCredits} trial credits.`,
      `The card on file will be charged tomorrow unless the trial is cancelled.`,
      ``,
      `This is the final reminder. Visit the Billing page to cancel or upgrade now.`,
    ].join("\n"),
  };
}

/**
 * Check if a reminder has already been sent for this tenant + day.
 * Uses a simple SQL table for idempotency tracking.
 */
async function checkReminderSent(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  tenantId: number,
  trialDay: number
): Promise<boolean> {
  const rows = await db.execute(
    sql`SELECT 1 FROM trial_reminders_sent WHERE tenant_id = ${tenantId} AND trial_day = ${trialDay} LIMIT 1`
  );
  return (rows as any).length > 0 || ((rows as any).rows?.length ?? 0) > 0;
}

/**
 * Mark a reminder as sent for this tenant + day.
 */
async function markReminderSent(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  tenantId: number,
  trialDay: number
): Promise<void> {
  await db.execute(
    sql`INSERT IGNORE INTO trial_reminders_sent (tenant_id, trial_day, sent_at) VALUES (${tenantId}, ${trialDay}, NOW())`
  );
}
