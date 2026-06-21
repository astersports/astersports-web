/**
 * Money-path INTEGRATION tests — exercise the REAL credit primitives against a
 * real MySQL (the rest of the suite mocks studioDb, so the atomic conditional
 * debit, (refId,reason) idempotency, and concurrency behavior were untested).
 *
 * Gated on RUN_DB_TESTS=1 (+ a DATABASE_URL pointing at a throwaway MySQL), so it
 * SKIPS in local runs and the normal CI job, and runs only in the dedicated
 * `db-integration` CI job that provisions MySQL. See .github/workflows/ci.yml.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "./db";
import { deductCredits, grantCredits, countJobGenerationAttempts } from "./studioDb";
import { tenants, creditLedger } from "../drizzle/schema";

const RUN = process.env.RUN_DB_TESTS === "1";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let db: any;

async function seedTenant(balance: number): Promise<number> {
  const slug = `it-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  const res = await db.insert(tenants).values({ name: "IT", slug, categoryId: 1, creditBalance: balance });
  // mysql2 returns insertId on the ResultSetHeader
  return (res as any)[0].insertId as number;
}

async function balanceOf(tid: number): Promise<number> {
  const [t] = await db.select().from(tenants).where(eq(tenants.id, tid)).limit(1);
  return t.creditBalance as number;
}

describe.skipIf(!RUN)("credit primitives (real MySQL)", () => {
  beforeAll(async () => {
    db = await getDb();
    if (!db) throw new Error("RUN_DB_TESTS set but getDb() returned null (DATABASE_URL?)");
  });

  it("deduct debits the balance and writes one ledger row", async () => {
    const tid = await seedTenant(100);
    const bal = await deductCredits(tid, 1, 30, "generation", `job-${tid}-a1`);
    expect(bal).toBe(70);
    const rows = await db.select().from(creditLedger).where(eq(creditLedger.tenantId, tid));
    expect(rows.length).toBe(1);
    expect(rows[0].delta).toBe(-30);
    expect(rows[0].balanceAfter).toBe(70);
  });

  it("deduct is idempotent on (refId,reason) — a retry does not double-debit", async () => {
    const tid = await seedTenant(100);
    const ref = `job-${tid}-a1`;
    expect(await deductCredits(tid, 1, 40, "generation", ref)).toBe(60);
    expect(await deductCredits(tid, 1, 40, "generation", ref)).toBe(60); // retry → no-op
    expect(await balanceOf(tid)).toBe(60);
    const rows = await db.select().from(creditLedger).where(eq(creditLedger.tenantId, tid));
    expect(rows.length).toBe(1);
  });

  it("deduct rejects (atomically) when the balance is insufficient", async () => {
    const tid = await seedTenant(10);
    await expect(deductCredits(tid, 1, 50, "generation", `job-${tid}-a1`)).rejects.toThrow(/insufficient/i);
    expect(await balanceOf(tid)).toBe(10); // unchanged, no ledger row
    const rows = await db.select().from(creditLedger).where(eq(creditLedger.tenantId, tid));
    expect(rows.length).toBe(0);
  });

  it("concurrent deducts never oversell (atomic conditional debit + row lock)", async () => {
    const tid = await seedTenant(100);
    const results = await Promise.allSettled(
      Array.from({ length: 20 }, (_, i) => deductCredits(tid, 1, 10, "generation", `job-${tid}-c${i}`))
    );
    const ok = results.filter((r) => r.status === "fulfilled").length;
    expect(ok).toBe(10); // exactly 100/10 succeed
    expect(await balanceOf(tid)).toBe(0); // never negative
  });

  it("grant is idempotent on (refId,reason) — duplicate delivery is a no-op", async () => {
    const tid = await seedTenant(0);
    const ref = `grant-${tid}`;
    expect(await grantCredits(tid, 50, "grant", ref)).toBe(50);
    expect(await grantCredits(tid, 50, "grant", ref)).toBe(50); // dup → no-op
    expect(await balanceOf(tid)).toBe(50);
  });

  it("countJobGenerationAttempts counts only this job's generation deducts", async () => {
    const tid = await seedTenant(1000);
    expect(await countJobGenerationAttempts(tid)).toBe(0);
    await deductCredits(tid, 1, 10, "generation", `job-${tid}-a1`);
    await deductCredits(tid, 1, 10, "generation", `job-${tid}-a2`);
    expect(await countJobGenerationAttempts(tid)).toBe(2);
  });
});
