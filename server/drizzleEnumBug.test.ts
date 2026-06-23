/**
 * P3: Reproduce or dismiss the TiDB/Drizzle eq()-on-enum bug.
 *
 * The hypothesis: Drizzle's eq() on a MySQL ENUM column returns empty results
 * in certain conditions (serverless cold-start, TiDB-specific behavior), while
 * inArray() with the same value works. This test seeds a row with status
 * 'sam2_processing' and queries it both ways to confirm or dismiss the bug.
 *
 * If this test passes consistently (both eq and inArray find the row), the bug
 * is environmental/transient and the inArray fix is a defensive workaround.
 * If eq() fails but inArray() succeeds, we've reproduced the bug.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getDb } from "./db";
import { jobs } from "../drizzle/schema";
import { eq, inArray, and, isNotNull } from "drizzle-orm";

// Gated on RUN_DB_TESTS=1 (+ a DATABASE_URL pointing at a throwaway MySQL), mirroring
// creditLedger.integration.test.ts. Without a DB, getDb() is null and beforeAll's
// db.insert() throws — a DB-coupled assertion in the unit suite red-lines CI for every
// lane (CLAUDE.md §5). The db-integration CI job sets RUN_DB_TESTS=1, so P3 still runs there.
const RUN = process.env.RUN_DB_TESTS === "1";

describe.skipIf(!RUN)("P3: Drizzle eq() vs inArray() on MySQL ENUM (TiDB)", () => {
  let db: NonNullable<Awaited<ReturnType<typeof getDb>>>;
  let seededJobId: number | null = null;

  beforeAll(async () => {
    db = (await getDb())!;
    // Seed a test row with status 'sam2_processing' and a unique predictionId
    const testPredictionId = `p3-test-${Date.now()}`;
    const [result] = await db.insert(jobs).values({
      tenantId: 0,
      userId: 0,
      title: "P3 enum bug test",
      originalKey: "test/p3-enum-bug.png",
      originalUrl: "https://example.com/p3-enum-bug.png",
      status: "sam2_processing",
      predictionId: testPredictionId,
      enqueuedAt: new Date(),
    }).$returningId();
    seededJobId = result.id;
    console.log(`[P3] Seeded job id=${seededJobId} with status=sam2_processing, predictionId=${testPredictionId}`);
  });

  afterAll(async () => {
    // Clean up the test row
    if (seededJobId) {
      await db.delete(jobs).where(eq(jobs.id, seededJobId));
      console.log(`[P3] Cleaned up job id=${seededJobId}`);
    }
  });

  it("eq(jobs.status, 'sam2_processing') should find the seeded row", async () => {
    const rows = await db
      .select({ id: jobs.id, status: jobs.status, predictionId: jobs.predictionId })
      .from(jobs)
      .where(
        and(
          eq(jobs.status, "sam2_processing"),
          eq(jobs.id, seededJobId!)
        )
      );
    console.log(`[P3] eq() result: ${JSON.stringify(rows)}`);
    expect(rows.length).toBe(1);
    expect(rows[0].id).toBe(seededJobId);
    expect(rows[0].status).toBe("sam2_processing");
  });

  it("inArray(jobs.status, ['sam2_processing']) should find the seeded row", async () => {
    const rows = await db
      .select({ id: jobs.id, status: jobs.status, predictionId: jobs.predictionId })
      .from(jobs)
      .where(
        and(
          inArray(jobs.status, ["sam2_processing"]),
          eq(jobs.id, seededJobId!)
        )
      );
    console.log(`[P3] inArray() result: ${JSON.stringify(rows)}`);
    expect(rows.length).toBe(1);
    expect(rows[0].id).toBe(seededJobId);
    expect(rows[0].status).toBe("sam2_processing");
  });

  it("listSam2ProcessingJobs pattern (inArray + isNotNull predictionId) should find the row", async () => {
    const rows = await db
      .select({ id: jobs.id, status: jobs.status, predictionId: jobs.predictionId })
      .from(jobs)
      .where(
        and(
          inArray(jobs.status, ["sam2_processing"]),
          isNotNull(jobs.predictionId)
        )
      )
      .limit(10);
    console.log(`[P3] listSam2ProcessingJobs pattern result: ${rows.length} rows, ids=${rows.map(r => r.id)}`);
    const found = rows.find(r => r.id === seededJobId);
    expect(found).toBeDefined();
    expect(found!.status).toBe("sam2_processing");
  });

  it("original eq() pattern (without id filter) should also find the row", async () => {
    // This is the exact pattern that was failing in production
    const rows = await db
      .select({ id: jobs.id, status: jobs.status, predictionId: jobs.predictionId })
      .from(jobs)
      .where(
        and(
          eq(jobs.status, "sam2_processing"),
          isNotNull(jobs.predictionId)
        )
      )
      .limit(10);
    console.log(`[P3] Original eq() pattern result: ${rows.length} rows, ids=${rows.map(r => r.id)}`);
    const found = rows.find(r => r.id === seededJobId);
    // If this fails, we've reproduced the bug
    expect(found).toBeDefined();
    expect(found!.status).toBe("sam2_processing");
  });
});
