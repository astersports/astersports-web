import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { Request, Response } from "express";

// Mock dependencies before importing the module under test
vi.mock("./stripe", () => ({
  stripe: {
    webhooks: {
      constructEvent: vi.fn(),
    },
    customers: {
      retrieve: vi.fn(),
    },
  },
}));

vi.mock("./db", () => ({
  getDb: vi.fn(),
}));

vi.mock("./_core/notification", () => ({
  notifyOwner: vi.fn().mockResolvedValue(true),
}));

vi.mock("./email", () => ({
  emailPaymentFailed: vi.fn().mockResolvedValue(true),
  emailSubscriptionCanceled: vi.fn().mockResolvedValue(true),
  emailSubscriptionActivated: vi.fn().mockResolvedValue(true),
}));

import { handleStripeWebhook } from "./webhook";
import { stripe } from "./stripe";
import { ENV } from "./_core/env";
import { getDb } from "./db";
import { notifyOwner } from "./_core/notification";
import { emailSubscriptionActivated, emailPaymentFailed, emailSubscriptionCanceled } from "./email";

// Helper to create mock Request/Response
function createMockReqRes(body: object) {
  const bodyStr = JSON.stringify(body);
  const req = {
    body: Buffer.from(bodyStr),
    headers: { "stripe-signature": "test_sig_123" },
  } as unknown as Request;

  const resData: { statusCode?: number; json?: unknown } = {};
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn((data: unknown) => {
      resData.json = data;
      return res;
    }),
  } as unknown as Response;

  return { req, res, resData };
}

describe("handleStripeWebhook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("signature verification", () => {
    // These cases assert the constructEvent (signature) branch, which the handler
    // only takes when a webhook secret is configured. Set one for the block so the
    // path is exercised regardless of the ambient env; restore after.
    let prevSecret: string;
    beforeEach(() => { prevSecret = ENV.stripeWebhookSecret; ENV.stripeWebhookSecret = "whsec_test_secret"; });
    afterEach(() => { ENV.stripeWebhookSecret = prevSecret; });

    it("returns verified: true for test events (evt_test_ prefix)", async () => {
      const testEvent = { id: "evt_test_abc123", type: "checkout.session.completed", data: {} };
      const { req, res } = createMockReqRes(testEvent);

      // Make constructEvent throw to simulate signature failure
      vi.mocked(stripe.webhooks.constructEvent).mockImplementation(() => {
        throw new Error("No signatures found matching the expected signature");
      });

      await handleStripeWebhook(req, res);

      expect(res.json).toHaveBeenCalledWith({ verified: true });
    });

    it("returns 400 for invalid signature on non-test events", async () => {
      const event = { id: "evt_real_abc123", type: "checkout.session.completed", data: {} };
      const { req, res } = createMockReqRes(event);

      vi.mocked(stripe.webhooks.constructEvent).mockImplementation(() => {
        throw new Error("Signature verification failed");
      });

      await handleStripeWebhook(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: "Webhook signature verification failed" });
    });
  });

  describe("checkout.session.completed", () => {
    const checkoutEvent = {
      id: "evt_123",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_test_abc",
          customer: "cus_test_123",
          subscription: "sub_test_456",
          metadata: { user_id: "1", customer_email: "client@example.com" },
        },
      },
    };

    it("updates existing client and sends notifications", async () => {
      vi.mocked(stripe.webhooks.constructEvent).mockReturnValue(checkoutEvent as any);

      const mockDb = {
        insert: vi.fn().mockReturnThis(),
        values: vi.fn().mockResolvedValue([{ insertId: 1 }]),
        update: vi.fn().mockReturnThis(),
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([{ affectedRows: 1 }]),
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([{ name: "Test Client", email: "client@example.com" }]),
      };
      vi.mocked(getDb).mockResolvedValue(mockDb as any);

      const { req, res } = createMockReqRes(checkoutEvent);
      await handleStripeWebhook(req, res);

      expect(res.json).toHaveBeenCalledWith({ received: true });
      expect(notifyOwner).toHaveBeenCalledWith(
        expect.objectContaining({ title: "New Subscription Activated" })
      );
      expect(emailSubscriptionActivated).toHaveBeenCalledWith(
        expect.objectContaining({ subscriptionId: "sub_test_456" })
      );
    });

    it("auto-creates client when no existing record found", async () => {
      vi.mocked(stripe.webhooks.constructEvent).mockReturnValue(checkoutEvent as any);

      // Mock DB: update returns 0 affected rows (no existing client)
      const mockDb = {
        update: vi.fn().mockReturnThis(),
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([{ affectedRows: 0 }]),
        insert: vi.fn().mockReturnThis(),
        values: vi.fn().mockResolvedValue([{ insertId: 1 }]),
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([]),
      };
      vi.mocked(getDb).mockResolvedValue(mockDb as any);

      // Mock Stripe customer retrieval for auto-create
      vi.mocked(stripe.customers.retrieve).mockResolvedValue({
        id: "cus_test_123",
        name: "Auto Client",
        email: "auto@example.com",
        deleted: false,
      } as any);

      const { req, res } = createMockReqRes(checkoutEvent);
      await handleStripeWebhook(req, res);

      expect(res.json).toHaveBeenCalledWith({ received: true });
      expect(stripe.customers.retrieve).toHaveBeenCalledWith("cus_test_123");
      expect(mockDb.insert).toHaveBeenCalled();
      expect(notifyOwner).toHaveBeenCalled();
      expect(emailSubscriptionActivated).toHaveBeenCalled();
    });

    it("skips processing when customer or subscription is missing", async () => {
      const incompleteEvent = {
        id: "evt_skip_123",
        type: "checkout.session.completed",
        data: {
          object: {
            id: "cs_test_abc",
            customer: null,
            subscription: null,
          },
        },
      };
      vi.mocked(stripe.webhooks.constructEvent).mockReturnValue(incompleteEvent as any);

      const mockDb = {
        insert: vi.fn().mockReturnThis(),
        values: vi.fn().mockResolvedValue([{ insertId: 1 }]),
      };
      vi.mocked(getDb).mockResolvedValue(mockDb as any);

      const { req, res } = createMockReqRes(incompleteEvent);
      await handleStripeWebhook(req, res);

      expect(res.json).toHaveBeenCalledWith({ received: true });
    });
  });

  describe("invoice.payment_failed", () => {
    it("sends payment failure notifications", async () => {
      const failedEvent = {
        id: "evt_456",
        type: "invoice.payment_failed",
        data: {
          object: {
            id: "in_test_789",
            customer: "cus_test_123",
            amount_due: 30000,
          },
        },
      };
      vi.mocked(stripe.webhooks.constructEvent).mockReturnValue(failedEvent as any);

      const mockDb = {
        insert: vi.fn().mockReturnThis(),
        values: vi.fn().mockResolvedValue([{ insertId: 1 }]),
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([{ name: "Test Client", email: "client@example.com" }]),
      };
      vi.mocked(getDb).mockResolvedValue(mockDb as any);

      const { req, res } = createMockReqRes(failedEvent);
      await handleStripeWebhook(req, res);

      expect(res.json).toHaveBeenCalledWith({ received: true });
      expect(notifyOwner).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Payment Failed" })
      );
      expect(emailPaymentFailed).toHaveBeenCalledWith(
        expect.objectContaining({
          clientName: "Test Client",
          amount: "300.00",
          invoiceId: "in_test_789",
        })
      );
    });
  });

  describe("customer.subscription.deleted", () => {
    it("updates status and sends cancellation notifications", async () => {
      const deletedEvent = {
        id: "evt_789",
        type: "customer.subscription.deleted",
        data: {
          object: {
            id: "sub_test_456",
            customer: "cus_test_123",
            status: "canceled",
          },
        },
      };
      vi.mocked(stripe.webhooks.constructEvent).mockReturnValue(deletedEvent as any);

      // The handler calls getDb() multiple times: idempotency insert, update, getClientInfo select
      const mockDb = {
        insert: vi.fn().mockReturnThis(),
        values: vi.fn().mockResolvedValue([{ insertId: 1 }]),
        update: vi.fn().mockReturnThis(),
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockImplementation(() => {
          return {
            limit: vi.fn().mockResolvedValue([{ name: "Test Client", email: "client@example.com" }]),
            then: (resolve: any) => resolve([{ affectedRows: 1 }]),
          } as any;
        }),
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([{ name: "Test Client", email: "client@example.com" }]),
      };
      vi.mocked(getDb).mockResolvedValue(mockDb as any);

      const { req, res } = createMockReqRes(deletedEvent);
      await handleStripeWebhook(req, res);

      expect(res.json).toHaveBeenCalledWith({ received: true });
      expect(mockDb.update).toHaveBeenCalled();
      expect(notifyOwner).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Subscription Canceled" })
      );
      expect(emailSubscriptionCanceled).toHaveBeenCalledWith(
        expect.objectContaining({
          clientName: "Test Client",
          subscriptionId: "sub_test_456",
        })
      );
    });
  });

  describe("error handling", () => {
    it("returns 500 when handler throws an unexpected error", async () => {
      const event = {
        id: "evt_err",
        type: "checkout.session.completed",
        data: {
          object: {
            id: "cs_test_err",
            customer: "cus_test_err",
            subscription: "sub_test_err",
          },
        },
      };
      vi.mocked(stripe.webhooks.constructEvent).mockReturnValue(event as any);
      // First call for idempotency succeeds, second call for handler throws
      const mockDb = {
        insert: vi.fn().mockReturnThis(),
        values: vi.fn().mockResolvedValue([{ insertId: 1 }]),
        delete: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue(undefined),
      };
      let callCount = 0;
      vi.mocked(getDb).mockImplementation(async () => {
        callCount++;
        if (callCount === 1) return mockDb as any; // idempotency
        throw new Error("DB connection failed");
      });

      const { req, res } = createMockReqRes(event);
      await handleStripeWebhook(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ error: "Webhook handler failed" });
    });

    it("does not crash when notifyOwner throws TRPCError", async () => {
      const checkoutEvent = {
        id: "evt_notify_err",
        type: "checkout.session.completed",
        data: {
          object: {
            id: "cs_test_notify",
            customer: "cus_test_notify",
            subscription: "sub_test_notify",
          },
        },
      };
      vi.mocked(stripe.webhooks.constructEvent).mockReturnValue(checkoutEvent as any);

      const mockDb = {
        insert: vi.fn().mockReturnThis(),
        values: vi.fn().mockResolvedValue([{ insertId: 1 }]),
        update: vi.fn().mockReturnThis(),
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([{ affectedRows: 1 }]),
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([{ name: "Client", email: "c@e.com" }]),
      };
      vi.mocked(getDb).mockResolvedValue(mockDb as any);

      // notifyOwner throws (simulating TRPCError)
      vi.mocked(notifyOwner).mockRejectedValue(new Error("TRPCError: INTERNAL_SERVER_ERROR"));

      const { req, res } = createMockReqRes(checkoutEvent);
      await handleStripeWebhook(req, res);

      // Should still return received: true (not 500)
      expect(res.json).toHaveBeenCalledWith({ received: true });
    });
  });
});
