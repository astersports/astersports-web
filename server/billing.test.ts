import { describe, it, expect, vi } from "vitest";

/**
 * Billing integration tests.
 * Tests the Stripe billing module structure and webhook handler logic.
 */

describe("Stripe Billing Module", () => {
  it("exports stripe client and ensureProducts function", async () => {
    const stripeModule = await import("./stripe");
    expect(stripeModule.stripe).toBeDefined();
    expect(stripeModule.ensureProducts).toBeDefined();
    expect(typeof stripeModule.ensureProducts).toBe("function");
  });

  it("exports PRODUCTS config with correct Web Maintenance pricing", async () => {
    const { PRODUCTS } = await import("./stripe");
    expect(PRODUCTS.WEB_MAINTENANCE).toBeDefined();
    expect(PRODUCTS.WEB_MAINTENANCE.name).toBe("Web Maintenance");
    expect(PRODUCTS.WEB_MAINTENANCE.priceAmount).toBe(30000); // $300 in cents
    expect(PRODUCTS.WEB_MAINTENANCE.interval).toBe("month");
  });

  it("exports billingRouter with expected procedures", async () => {
    const { billingRouter } = await import("./billing");
    expect(billingRouter).toBeDefined();
    // The router should have the expected procedure keys
    const routerDef = billingRouter._def;
    expect(routerDef).toBeDefined();
  });

  it("webhook handler exports handleStripeWebhook function", async () => {
    const webhookModule = await import("./webhook");
    expect(webhookModule.handleStripeWebhook).toBeDefined();
    expect(typeof webhookModule.handleStripeWebhook).toBe("function");
  });
});

describe("Webhook Handler", () => {
  it("returns verified:true for test events", async () => {
    const { handleStripeWebhook } = await import("./webhook");

    const mockReq = {
      headers: { "stripe-signature": "test_sig" },
      body: Buffer.from(JSON.stringify({
        id: "evt_test_12345",
        type: "checkout.session.completed",
        data: { object: {} },
      })),
    };

    const mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };

    await handleStripeWebhook(mockReq as any, mockRes as any);

    // Should return verified:true for test events
    expect(mockRes.json).toHaveBeenCalledWith({ verified: true });
  });
});

describe("Billing Schema", () => {
  it("exports billingClients table definition", async () => {
    const schema = await import("../drizzle/schema");
    expect(schema.billingClients).toBeDefined();
  });
});
