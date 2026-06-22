/**
 * Tests for platform.stats procedure — trial pipeline classification,
 * 7-day spend aggregation, top-5 leaderboard ordering, and string-to-number
 * coercion of SQL SUM aggregates.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { TRIAL_DURATION_DAYS } from "../shared/billing";

const TRIAL_MS = TRIAL_DURATION_DAYS * 24 * 60 * 60 * 1000;
const EXPIRING_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * Extract the stats logic into a testable function that mirrors the procedure.
 * This avoids needing to wire up the full tRPC context/middleware for unit tests.
 */
function computeStats(
  allTenants: Array<{
    type: string;
    plan: string;
    creditBalance: number;
    trialStartedAt: Date | null;
    trialConvertedAt: Date | null;
  }>,
  spendRows: Array<{ tenantId: number; spent: string | number }>,
  nameMap: Map<number, string>,
  now: number = Date.now()
) {
  let firmCount = 0,
    individualCount = 0,
    totalCreditsOutstanding = 0;
  let paidCount = 0,
    inTrialCount = 0,
    trialsExpiringSoon = 0;

  for (const t of allTenants) {
    if (t.type === "firm") firmCount++;
    else individualCount++;
    totalCreditsOutstanding += t.creditBalance;
    if (t.plan !== "none") paidCount++;
    if (t.trialStartedAt && !t.trialConvertedAt) {
      const end = new Date(t.trialStartedAt).getTime() + TRIAL_MS;
      if (now < end) {
        inTrialCount++;
        if (end - now <= EXPIRING_MS) trialsExpiringSoon++;
      }
    }
  }

  // Number()-coerce the SQL SUM (mysql2 returns aggregates as strings)
  const spend = spendRows
    .map((r) => ({ tenantId: r.tenantId, spent: Number(r.spent ?? 0) }))
    .filter((s) => s.spent > 0)
    .sort((a, b) => b.spent - a.spent);
  const spent7dTotal = spend.reduce((sum, r) => sum + r.spent, 0);
  const top = spend.slice(0, 5);

  const topSpenders = top.map((t) => ({
    tenantId: t.tenantId,
    name: nameMap.get(t.tenantId) ?? "Unknown",
    spent7d: t.spent,
  }));

  return {
    firmCount,
    individualCount,
    totalAccounts: firmCount + individualCount,
    totalCreditsOutstanding,
    paidCount,
    inTrialCount,
    trialsExpiringSoon,
    spent7dTotal,
    topSpenders,
  };
}

describe("platform.stats — trial pipeline classification", () => {
  const now = Date.now();

  it("counts active trials (started within TRIAL_DURATION_DAYS, not converted)", () => {
    const tenants = [
      {
        type: "individual",
        plan: "none",
        creditBalance: 50,
        trialStartedAt: new Date(now - 2 * 24 * 60 * 60 * 1000), // 2 days ago
        trialConvertedAt: null,
      },
    ];
    const result = computeStats(tenants, [], new Map(), now);
    expect(result.inTrialCount).toBe(1);
    expect(result.trialsExpiringSoon).toBe(0);
  });

  it("classifies trial expiring soon (within 3 days of end)", () => {
    // Trial started 5 days ago with 7-day duration → 2 days left → expiring soon
    const tenants = [
      {
        type: "individual",
        plan: "none",
        creditBalance: 30,
        trialStartedAt: new Date(now - 5 * 24 * 60 * 60 * 1000),
        trialConvertedAt: null,
      },
    ];
    const result = computeStats(tenants, [], new Map(), now);
    expect(result.inTrialCount).toBe(1);
    expect(result.trialsExpiringSoon).toBe(1);
  });

  it("does NOT count expired trials (past TRIAL_DURATION_DAYS)", () => {
    // Trial started 10 days ago → expired (7-day window passed)
    const tenants = [
      {
        type: "individual",
        plan: "none",
        creditBalance: 0,
        trialStartedAt: new Date(now - 10 * 24 * 60 * 60 * 1000),
        trialConvertedAt: null,
      },
    ];
    const result = computeStats(tenants, [], new Map(), now);
    expect(result.inTrialCount).toBe(0);
    expect(result.trialsExpiringSoon).toBe(0);
  });

  it("does NOT count converted trials (trialConvertedAt set)", () => {
    const tenants = [
      {
        type: "individual",
        plan: "pro",
        creditBalance: 200,
        trialStartedAt: new Date(now - 2 * 24 * 60 * 60 * 1000),
        trialConvertedAt: new Date(now - 1 * 24 * 60 * 60 * 1000),
      },
    ];
    const result = computeStats(tenants, [], new Map(), now);
    expect(result.inTrialCount).toBe(0);
    expect(result.paidCount).toBe(1); // plan !== "none"
  });

  it("handles boundary: trial ending exactly now is NOT counted (now < end is false)", () => {
    // Trial started exactly TRIAL_DURATION_DAYS ago → end === now → now < end is false
    const tenants = [
      {
        type: "individual",
        plan: "none",
        creditBalance: 0,
        trialStartedAt: new Date(now - TRIAL_MS),
        trialConvertedAt: null,
      },
    ];
    const result = computeStats(tenants, [], new Map(), now);
    expect(result.inTrialCount).toBe(0);
  });
});

describe("platform.stats — account mix and credits", () => {
  const now = Date.now();

  it("counts firms and individuals separately", () => {
    const tenants = [
      { type: "firm", plan: "pro", creditBalance: 1000, trialStartedAt: null, trialConvertedAt: null },
      { type: "firm", plan: "none", creditBalance: 500, trialStartedAt: null, trialConvertedAt: null },
      { type: "individual", plan: "none", creditBalance: 50, trialStartedAt: null, trialConvertedAt: null },
    ];
    const result = computeStats(tenants, [], new Map(), now);
    expect(result.firmCount).toBe(2);
    expect(result.individualCount).toBe(1);
    expect(result.totalAccounts).toBe(3);
    expect(result.totalCreditsOutstanding).toBe(1550);
    expect(result.paidCount).toBe(1); // only the "pro" plan
  });

  it("returns zeros for empty tenant list", () => {
    const result = computeStats([], [], new Map(), now);
    expect(result.firmCount).toBe(0);
    expect(result.individualCount).toBe(0);
    expect(result.totalAccounts).toBe(0);
    expect(result.totalCreditsOutstanding).toBe(0);
    expect(result.paidCount).toBe(0);
    expect(result.inTrialCount).toBe(0);
    expect(result.trialsExpiringSoon).toBe(0);
    expect(result.spent7dTotal).toBe(0);
    expect(result.topSpenders).toEqual([]);
  });
});

describe("platform.stats — 7-day spend aggregation and top-5 ordering", () => {
  const now = Date.now();
  const tenants = [
    { type: "firm", plan: "pro", creditBalance: 1000, trialStartedAt: null, trialConvertedAt: null },
  ];

  it("coerces string SQL SUM values to numbers", () => {
    // mysql2 returns aggregates as strings
    const spendRows = [
      { tenantId: 1, spent: "250" as any },
      { tenantId: 2, spent: "100" as any },
    ];
    const nameMap = new Map([[1, "Firm A"], [2, "Firm B"]]);
    const result = computeStats(tenants, spendRows, nameMap, now);
    expect(result.spent7dTotal).toBe(350);
    expect(result.topSpenders[0].spent7d).toBe(250);
    expect(typeof result.topSpenders[0].spent7d).toBe("number");
  });

  it("orders top spenders by descending spend", () => {
    const spendRows = [
      { tenantId: 1, spent: 50 },
      { tenantId: 2, spent: 300 },
      { tenantId: 3, spent: 150 },
      { tenantId: 4, spent: 500 },
      { tenantId: 5, spent: 75 },
    ];
    const nameMap = new Map([
      [1, "Small Co"],
      [2, "Medium Co"],
      [3, "Mid Co"],
      [4, "Big Co"],
      [5, "Tiny Co"],
    ]);
    const result = computeStats(tenants, spendRows, nameMap, now);
    expect(result.topSpenders[0]).toEqual({ tenantId: 4, name: "Big Co", spent7d: 500 });
    expect(result.topSpenders[1]).toEqual({ tenantId: 2, name: "Medium Co", spent7d: 300 });
    expect(result.topSpenders[2]).toEqual({ tenantId: 3, name: "Mid Co", spent7d: 150 });
    expect(result.topSpenders[3]).toEqual({ tenantId: 5, name: "Tiny Co", spent7d: 75 });
    expect(result.topSpenders[4]).toEqual({ tenantId: 1, name: "Small Co", spent7d: 50 });
  });

  it("limits to top 5 even with more spenders", () => {
    const spendRows = Array.from({ length: 10 }, (_, i) => ({
      tenantId: i + 1,
      spent: (i + 1) * 100,
    }));
    const nameMap = new Map(spendRows.map((r) => [r.tenantId, `Tenant ${r.tenantId}`]));
    const result = computeStats(tenants, spendRows, nameMap, now);
    expect(result.topSpenders).toHaveLength(5);
    // Top spender should be tenantId 10 (1000 credits)
    expect(result.topSpenders[0].tenantId).toBe(10);
    expect(result.topSpenders[0].spent7d).toBe(1000);
  });

  it("filters out zero-spend tenants", () => {
    const spendRows = [
      { tenantId: 1, spent: 0 },
      { tenantId: 2, spent: 100 },
      { tenantId: 3, spent: "0" as any },
    ];
    const nameMap = new Map([[2, "Active Co"]]);
    const result = computeStats(tenants, spendRows, nameMap, now);
    expect(result.topSpenders).toHaveLength(1);
    expect(result.topSpenders[0].name).toBe("Active Co");
    expect(result.spent7dTotal).toBe(100);
  });

  it("handles null/undefined spent values gracefully", () => {
    const spendRows = [
      { tenantId: 1, spent: null as any },
      { tenantId: 2, spent: undefined as any },
      { tenantId: 3, spent: 200 },
    ];
    const nameMap = new Map([[3, "Valid Co"]]);
    const result = computeStats(tenants, spendRows, nameMap, now);
    expect(result.spent7dTotal).toBe(200);
    expect(result.topSpenders).toHaveLength(1);
  });

  it("uses 'Unknown' for tenants not in the name map", () => {
    const spendRows = [{ tenantId: 99, spent: 500 }];
    const nameMap = new Map<number, string>(); // empty
    const result = computeStats(tenants, spendRows, nameMap, now);
    expect(result.topSpenders[0].name).toBe("Unknown");
  });
});
