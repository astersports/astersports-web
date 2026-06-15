/**
 * Email notification helper using Resend.
 * Sends billing event notifications from billing@astersports.app to frank@astersports.co.
 */
import { ENV } from "./_core/env";

const RESEND_API_URL = "https://api.resend.com/emails";
const FROM_EMAIL = "Aster Sports Billing <billing@astersports.app>";
const OWNER_EMAIL = "frank@astersports.co";

interface EmailPayload {
  subject: string;
  html: string;
  text: string;
}

/**
 * Send an email notification via Resend API.
 * Falls back gracefully if Resend API key is not configured.
 */
async function sendEmail(payload: EmailPayload): Promise<boolean> {
  const apiKey = ENV.resendApiKey;

  if (!apiKey) {
    console.warn("[Email] Resend API key not configured, skipping email notification");
    return false;
  }

  try {
    const response = await fetch(RESEND_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: [OWNER_EMAIL],
        subject: payload.subject,
        html: payload.html,
        text: payload.text,
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      console.error(`[Email] Resend API error (${response.status}): ${detail}`);
      return false;
    }

    const result = await response.json();
    console.log(`[Email] Sent successfully: ${result.id}`);
    return true;
  } catch (err) {
    console.error("[Email] Failed to send:", (err as Error).message);
    return false;
  }
}

/**
 * Notify owner of a payment failure.
 */
export async function emailPaymentFailed({
  clientName,
  clientEmail,
  amount,
  invoiceId,
}: {
  clientName: string;
  clientEmail: string;
  amount: string;
  invoiceId: string;
}): Promise<boolean> {
  return sendEmail({
    subject: `⚠️ Payment Failed — ${clientName} ($${amount})`,
    text: `Payment failed for ${clientName} (${clientEmail}).\n\nAmount: $${amount}\nInvoice: ${invoiceId}\n\nLog in to your billing dashboard to follow up:\nhttps://astersports.io/admin/billing`,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 560px; margin: 0 auto; padding: 32px 24px;">
        <div style="border-left: 4px solid #e74c3c; padding-left: 16px; margin-bottom: 24px;">
          <h2 style="margin: 0 0 8px; color: #1a1a2e; font-size: 20px;">Payment Failed</h2>
          <p style="margin: 0; color: #666; font-size: 14px;">A client's payment could not be processed.</p>
        </div>
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
          <tr><td style="padding: 8px 0; color: #888; font-size: 13px;">Client</td><td style="padding: 8px 0; font-size: 14px; font-weight: 500;">${clientName}</td></tr>
          <tr><td style="padding: 8px 0; color: #888; font-size: 13px;">Email</td><td style="padding: 8px 0; font-size: 14px;">${clientEmail}</td></tr>
          <tr><td style="padding: 8px 0; color: #888; font-size: 13px;">Amount</td><td style="padding: 8px 0; font-size: 14px; font-weight: 500; color: #e74c3c;">$${amount}</td></tr>
          <tr><td style="padding: 8px 0; color: #888; font-size: 13px;">Invoice</td><td style="padding: 8px 0; font-size: 14px; font-family: monospace;">${invoiceId}</td></tr>
        </table>
        <a href="https://astersports.io/admin/billing" style="display: inline-block; padding: 10px 20px; background: #f5b731; color: #0a0e1a; text-decoration: none; border-radius: 6px; font-size: 14px; font-weight: 600;">View Billing Dashboard</a>
        <p style="margin-top: 24px; font-size: 12px; color: #999;">Aster Sports Billing System</p>
      </div>
    `,
  });
}

/**
 * Notify owner of a subscription cancellation.
 */
export async function emailSubscriptionCanceled({
  clientName,
  clientEmail,
  subscriptionId,
}: {
  clientName: string;
  clientEmail: string;
  subscriptionId: string;
}): Promise<boolean> {
  return sendEmail({
    subject: `🚫 Subscription Canceled — ${clientName}`,
    text: `${clientName} (${clientEmail}) has canceled their subscription.\n\nSubscription: ${subscriptionId}\n\nLog in to your billing dashboard:\nhttps://astersports.io/admin/billing`,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 560px; margin: 0 auto; padding: 32px 24px;">
        <div style="border-left: 4px solid #e67e22; padding-left: 16px; margin-bottom: 24px;">
          <h2 style="margin: 0 0 8px; color: #1a1a2e; font-size: 20px;">Subscription Canceled</h2>
          <p style="margin: 0; color: #666; font-size: 14px;">A client has canceled their recurring subscription.</p>
        </div>
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
          <tr><td style="padding: 8px 0; color: #888; font-size: 13px;">Client</td><td style="padding: 8px 0; font-size: 14px; font-weight: 500;">${clientName}</td></tr>
          <tr><td style="padding: 8px 0; color: #888; font-size: 13px;">Email</td><td style="padding: 8px 0; font-size: 14px;">${clientEmail}</td></tr>
          <tr><td style="padding: 8px 0; color: #888; font-size: 13px;">Subscription</td><td style="padding: 8px 0; font-size: 14px; font-family: monospace;">${subscriptionId}</td></tr>
        </table>
        <a href="https://astersports.io/admin/billing" style="display: inline-block; padding: 10px 20px; background: #f5b731; color: #0a0e1a; text-decoration: none; border-radius: 6px; font-size: 14px; font-weight: 600;">View Billing Dashboard</a>
        <p style="margin-top: 24px; font-size: 12px; color: #999;">Aster Sports Billing System</p>
      </div>
    `,
  });
}

/**
 * Notify owner of a new subscription activation.
 */
export async function emailSubscriptionActivated({
  clientName,
  clientEmail,
  subscriptionId,
}: {
  clientName: string;
  clientEmail: string;
  subscriptionId: string;
}): Promise<boolean> {
  return sendEmail({
    subject: `✅ New Subscription — ${clientName}`,
    text: `${clientName} (${clientEmail}) has activated a subscription.\n\nSubscription: ${subscriptionId}\n\nView in your billing dashboard:\nhttps://astersports.io/admin/billing`,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 560px; margin: 0 auto; padding: 32px 24px;">
        <div style="border-left: 4px solid #27ae60; padding-left: 16px; margin-bottom: 24px;">
          <h2 style="margin: 0 0 8px; color: #1a1a2e; font-size: 20px;">New Subscription Activated</h2>
          <p style="margin: 0; color: #666; font-size: 14px;">A client has started a new recurring subscription.</p>
        </div>
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
          <tr><td style="padding: 8px 0; color: #888; font-size: 13px;">Client</td><td style="padding: 8px 0; font-size: 14px; font-weight: 500;">${clientName}</td></tr>
          <tr><td style="padding: 8px 0; color: #888; font-size: 13px;">Email</td><td style="padding: 8px 0; font-size: 14px;">${clientEmail}</td></tr>
          <tr><td style="padding: 8px 0; color: #888; font-size: 13px;">Subscription</td><td style="padding: 8px 0; font-size: 14px; font-family: monospace;">${subscriptionId}</td></tr>
        </table>
        <a href="https://astersports.io/admin/billing" style="display: inline-block; padding: 10px 20px; background: #f5b731; color: #0a0e1a; text-decoration: none; border-radius: 6px; font-size: 14px; font-weight: 600;">View Billing Dashboard</a>
        <p style="margin-top: 24px; font-size: 12px; color: #999;">Aster Sports Billing System</p>
      </div>
    `,
  });
}
