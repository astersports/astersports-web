import { describe, it, expect, vi, beforeEach } from "vitest";

// Create separate select and update chains so .where() behaves differently in each context
function createMockDb() {
  // Select chain: select().from().where().limit()
  const selectChain: any = {};
  selectChain.from = vi.fn().mockReturnValue(selectChain);
  selectChain.where = vi.fn().mockReturnValue(selectChain);
  selectChain.limit = vi.fn().mockResolvedValue([]);

  // Update chain: update().set().where()
  const updateChain: any = {};
  updateChain.set = vi.fn().mockReturnValue(updateChain);
  updateChain.where = vi.fn().mockResolvedValue([]);

  const db: any = {
    select: vi.fn().mockReturnValue(selectChain),
    update: vi.fn().mockReturnValue(updateChain),
    _selectChain: selectChain,
    _updateChain: updateChain,
  };
  return db;
}

const mockDb = createMockDb();

vi.mock("./db", () => ({
  getDb: vi.fn().mockResolvedValue(mockDb),
}));

vi.mock("./stripe", () => ({
  stripe: {
    customers: {
      create: vi.fn().mockResolvedValue({ id: "cus_test123" }),
    },
    setupIntents: {
      create: vi.fn().mockResolvedValue({
        id: "seti_test123",
        client_secret: "seti_test123_secret_abc",
      }),
    },
    paymentIntents: {
      create: vi.fn().mockResolvedValue({
        id: "pi_test123",
        status: "succeeded",
      }),
    },
    subscriptions: {
      create: vi.fn().mockResolvedValue({
        id: "sub_test123",
        status: "active",
      }),
    },
  },
  ensureStudioPrice: vi.fn().mockResolvedValue("price_test123"),
}));

vi.mock("./studioDb", () => ({
  grantCredits: vi.fn().mockResolvedValue(undefined),
  updateTenantStripe: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./_core/notification", () => ({
  notifyOwner: vi.fn().mockResolvedValue(true),
}));

vi.mock("./serverLog", () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((...args: any[]) => ({ type: "eq", args })),
  and: vi.fn((...args: any[]) => ({ type: "and", args })),
  isNotNull: vi.fn((col: any) => ({ type: "isNotNull", col })),
  isNull: vi.fn((col: any) => ({ type: "isNull", col })),
  lte: vi.fn((...args: any[]) => ({ type: "lte", args })),
  sql: vi.fn(),
}));

vi.mock("../drizzle/schema", () => ({
  tenants: {
    id: "tenants.id",
    stripeCustomerId: "tenants.stripeCustomerId",
    stripeSetupIntentId: "tenants.stripeSetupIntentId",
    stripePaymentMethodId: "tenants.stripePaymentMethodId",
    creditBalance: "tenants.creditBalance",
    trialFrozenCredits: "tenants.trialFrozenCredits",
    trialFrozenAt: "tenants.trialFrozenAt",
    trialStartedAt: "tenants.trialStartedAt",
    trialConvertedAt: "tenants.trialConvertedAt",
    plan: "tenants.plan",
    name: "tenants.name",
    seats: "tenants.seats",
  },
}));

vi.mock("../shared/billing", () => ({
  TRIAL_DURATION_DAYS: 7,
  PLANS: {
    starter: { name: "Starter", priceMonthly: 39, creditsPerCycle: 100, perSeat: false },
    pro: { name: "Pro", priceMonthly: 199, creditsPerCycle: 500, perSeat: false },
    team: { name: "Team", priceMonthly: 20, creditsPerCycle: 100, perSeat: true },
    none: null,
  },
}));

describe("shadowBilling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset select chain
    mockDb.select.mockReturnValue(mockDb._selectChain);
    mockDb._selectChain.from.mockReturnValue(mockDb._selectChain);
    mockDb._selectChain.where.mockReturnValue(mockDb._selectChain);
    mockDb._selectChain.limit.mockResolvedValue([]);
    // Reset update chain
    mockDb.update.mockReturnValue(mockDb._updateChain);
    mockDb._updateChain.set.mockReturnValue(mockDb._updateChain);
    mockDb._updateChain.where.mockResolvedValue([]);
  });

  describe("createOrgSetupIntent", () => {
    it("creates a Stripe customer if tenant has none", async () => {
      mockDb._selectChain.limit.mockResolvedValueOnce([{ stripeCustomerId: null }]);

      const { createOrgSetupIntent } = await import("./shadowBilling");
      const { stripe } = await import("./stripe");
      const result = await createOrgSetupIntent(1, "Test Firm", "owner@test.com");

      expect(result.clientSecret).toBe("seti_test123_secret_abc");
      expect(result.setupIntentId).toBe("seti_test123");
      expect(stripe.customers.create).toHaveBeenCalledWith(
        expect.objectContaining({ name: "Test Firm", email: "owner@test.com" })
      );
    });

    it("reuses existing Stripe customer", async () => {
      mockDb._selectChain.limit.mockResolvedValueOnce([{ stripeCustomerId: "cus_existing" }]);

      const { stripe } = await import("./stripe");
      const { createOrgSetupIntent } = await import("./shadowBilling");
      await createOrgSetupIntent(1, "Test Firm", "owner@test.com");

      expect(stripe.customers.create).not.toHaveBeenCalled();
    });

    it("throws if DB is unavailable", async () => {
      const { getDb } = await import("./db");
      (getDb as any).mockResolvedValueOnce(null);

      const { createOrgSetupIntent } = await import("./shadowBilling");
      await expect(createOrgSetupIntent(1, "Test", "a@b.com")).rejects.toThrow("DB unavailable");
    });
  });

  describe("handleSetupIntentSucceeded", () => {
    it("stores the payment method on the tenant", async () => {
      const { handleSetupIntentSucceeded } = await import("./shadowBilling");
      await handleSetupIntentSucceeded("seti_123", "pm_abc", 42);

      expect(mockDb.update).toHaveBeenCalled();
      expect(mockDb._updateChain.set).toHaveBeenCalledWith({ stripePaymentMethodId: "pm_abc" });
    });
  });

  describe("cancelTrialAndFreezeCredits", () => {
    it("freezes the current balance and zeros it out", async () => {
      mockDb._selectChain.limit.mockResolvedValueOnce([{ creditBalance: 35 }]);

      const { cancelTrialAndFreezeCredits } = await import("./shadowBilling");
      const result = await cancelTrialAndFreezeCredits(7);

      expect(result.frozenCredits).toBe(35);
      expect(mockDb._updateChain.set).toHaveBeenCalledWith(
        expect.objectContaining({
          creditBalance: 0,
          trialFrozenCredits: 35,
        })
      );
    });

    it("returns 0 frozen credits if balance is already 0", async () => {
      mockDb._selectChain.limit.mockResolvedValueOnce([{ creditBalance: 0 }]);

      const { cancelTrialAndFreezeCredits } = await import("./shadowBilling");
      const result = await cancelTrialAndFreezeCredits(7);

      expect(result.frozenCredits).toBe(0);
    });
  });

  describe("restoreFrozenCreditsIfEligible", () => {
    it("restores credits if within 90-day window", async () => {
      const frozenAt = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // 30 days ago
      mockDb._selectChain.limit.mockResolvedValueOnce([
        { trialFrozenCredits: 50, trialFrozenAt: frozenAt, creditBalance: 100 },
      ]);

      const { restoreFrozenCreditsIfEligible } = await import("./shadowBilling");
      const restored = await restoreFrozenCreditsIfEligible(10);

      expect(restored).toBe(50);
    });

    it("does not restore credits if past 90-day window", async () => {
      const frozenAt = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000); // 100 days ago
      mockDb._selectChain.limit.mockResolvedValueOnce([
        { trialFrozenCredits: 50, trialFrozenAt: frozenAt, creditBalance: 0 },
      ]);

      const { restoreFrozenCreditsIfEligible } = await import("./shadowBilling");
      const restored = await restoreFrozenCreditsIfEligible(10);

      expect(restored).toBe(0);
    });

    it("returns 0 if no frozen credits exist", async () => {
      mockDb._selectChain.limit.mockResolvedValueOnce([
        { trialFrozenCredits: null, trialFrozenAt: null, creditBalance: 100 },
      ]);

      const { restoreFrozenCreditsIfEligible } = await import("./shadowBilling");
      const restored = await restoreFrozenCreditsIfEligible(10);

      expect(restored).toBe(0);
    });
  });

  describe("convertTrialToPaid", () => {
    it("sets plan to starter and grants 100 credits", async () => {
      const { convertTrialToPaid } = await import("./shadowBilling");
      const { grantCredits } = await import("./studioDb");

      await convertTrialToPaid(5, "starter", "pi_ref123");

      expect(grantCredits).toHaveBeenCalledWith(5, 100, "subscription_start", "pi_ref123");
    });

    it("throws for 'none' plan", async () => {
      const { convertTrialToPaid } = await import("./shadowBilling");
      await expect(convertTrialToPaid(5, "none" as any, "ref")).rejects.toThrow();
    });

    it("stores the subscription id and grants once when a subscription is provided", async () => {
      const { convertTrialToPaid } = await import("./shadowBilling");
      const { grantCredits } = await import("./studioDb");

      await convertTrialToPaid(5, "starter", "sub_x", "sub_x");

      expect(mockDb._updateChain.set).toHaveBeenCalledWith(
        expect.objectContaining({ plan: "starter", stripeSubscriptionId: "sub_x" })
      );
      expect(grantCredits).toHaveBeenCalledWith(5, 100, "subscription_start", "sub_x");
    });
  });
});
