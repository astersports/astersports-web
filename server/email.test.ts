import { describe, it, expect } from "vitest";

describe("Resend Email Integration", () => {
  // Credential-presence + live-send checks: only meaningful where RESEND_API_KEY
  // is configured. Skipped in a clean environment (CI) where it is absent.
  const hasKey = !!process.env.RESEND_API_KEY;

  it.skipIf(!hasKey)("validates RESEND_API_KEY is configured", () => {
    const apiKey = process.env.RESEND_API_KEY;
    expect(apiKey).toBeTruthy();
    expect(apiKey!.startsWith("re_")).toBe(true);
  });

  it.skipIf(!hasKey)("can send a test email from billing@astersports.app", async () => {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey || apiKey === "re_Si2Fq7Sk_K7uRUyvHtX9p81jYvPfBq9x3") {
      // Skip if using the old restricted key (shell env not updated yet)
      console.log("[Test] Skipping send test — old key still in shell env");
      return;
    }

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Aster Sports Billing <billing@astersports.app>",
        to: ["frank@astersports.co"],
        subject: "Test: Billing Notification System Active",
        text: "This is a test email confirming your Aster Sports billing notification system is working correctly.",
        html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 560px; margin: 0 auto; padding: 32px 24px;">
            <div style="border-left: 4px solid #27ae60; padding-left: 16px; margin-bottom: 24px;">
              <h2 style="margin: 0 0 8px; color: #1a1a2e; font-size: 20px;">Billing Notifications Active</h2>
              <p style="margin: 0; color: #666; font-size: 14px;">Your email notification system is working correctly.</p>
            </div>
            <p style="color: #333; font-size: 14px; line-height: 1.6;">
              You will receive email alerts at this address for:
            </p>
            <ul style="color: #333; font-size: 14px; line-height: 1.8;">
              <li>Payment failures</li>
              <li>Subscription cancellations</li>
              <li>New subscription activations</li>
            </ul>
            <p style="margin-top: 24px; font-size: 12px; color: #999;">Aster Sports Billing System</p>
          </div>
        `,
      }),
    });

    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.id).toBeTruthy();
    console.log(`[Test] Email sent successfully with ID: ${result.id}`);
  });
});
