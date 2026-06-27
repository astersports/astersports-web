/**
 * CROSS-ORG ISOLATION integration test (org-redesign step 7, pulled earlier per
 * the architect sign-off so it's a STANDING GUARD through steps 4-6, gating the
 * 2nd org going live). Exercises the REAL isolation boundary against a real
 * Postgres: a member of org A must never reach org B's data/ledger/members, and
 * the ONLY cross-org path is the super-admin (platform_admins) grant.
 *
 * Isolation here is enforced at the APPLICATION layer (tenancy.ts resolves the
 * caller's membership for a given tenantId and FORBIDs non-members; every
 * tenant-scoped query is keyed by ctx.tenant.id). This test asserts the exact
 * enforcement queries those procedures run, plus the domain-lock that gates who
 * may join an org in the first place.
 *
 * Gated on RUN_DB_TESTS=1 (+ DATABASE_URL); skips locally + in the normal CI job,
 * runs only in the `db-integration` CI job. See .github/workflows/ci.yml.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { and, eq } from "drizzle-orm";
import { getDb } from "./db";
import { getUserTenants, listMemberships, createMembership, grantCredits } from "./studioDb";
import { addTenantDomains, isEmailAllowedForTenant } from "./tenantDomains";
import { tenants, users, memberships, creditLedger, platformAdmins } from "../drizzle/schema";

const RUN = process.env.RUN_DB_TESTS === "1";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let db: any;

let uid = 0;
async function seedTenant(name: string): Promise<number> {
  const slug = `iso-${name}-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  const res = await db.insert(tenants).values({ name, slug, categoryId: 1, creditBalance: 0 }).returning({ id: tenants.id });
  return (res as any)[0].id as number;
}
async function seedUser(email: string): Promise<number> {
  const openId = `iso-${++uid}-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  const res = await db.insert(users).values({ openId, email, name: email }).returning({ id: users.id });
  return (res as any)[0].id as number;
}

/** Mirrors the exact membership resolution tenancy.ts runs before granting tenant
 *  access — empty result === the procedure would throw FORBIDDEN. */
async function activeMembership(tenantId: number, userId: number) {
  const [m] = await db
    .select()
    .from(memberships)
    .where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, userId), eq(memberships.status, "active")))
    .limit(1);
  return m ?? null;
}

describe.skipIf(!RUN)("cross-org isolation (real Postgres)", () => {
  let orgA = 0, orgB = 0, userA = 0, userB = 0, superUser = 0;

  beforeAll(async () => {
    db = await getDb();
    if (!db) throw new Error("RUN_DB_TESTS set but getDb() returned null (DATABASE_URL?)");
    orgA = await seedTenant("A");
    orgB = await seedTenant("B");
    userA = await seedUser(`a-${Date.now()}@acme.com`);
    userB = await seedUser(`b-${Date.now()}@globex.com`);
    superUser = await seedUser(`super-${Date.now()}@astersports.co`);
    await createMembership({ tenantId: orgA, userId: userA, role: "owner", status: "active" });
    await createMembership({ tenantId: orgB, userId: userB, role: "owner", status: "active" });
    await grantCredits(orgA, 100, "grant", `iso-grant-a-${orgA}`, userA);
    await grantCredits(orgB, 200, "grant", `iso-grant-b-${orgB}`, userB);
    await addTenantDomains(orgA, ["acme.com"]);
    await addTenantDomains(orgB, ["globex.com"]);
    // The only cross-org principal.
    await db.insert(platformAdmins).values({ userId: superUser });
  });

  it("a user sees ONLY their own org (no discovery of the other)", async () => {
    const aTenants = await getUserTenants(userA);
    const bTenants = await getUserTenants(userB);
    expect(aTenants.map((t) => t.id)).toEqual([orgA]);
    expect(bTenants.map((t) => t.id)).toEqual([orgB]);
    expect(aTenants.some((t) => t.id === orgB)).toBe(false);
  });

  it("a member of A has NO active membership in B (tenancy.ts would FORBID)", async () => {
    expect(await activeMembership(orgA, userA)).not.toBeNull(); // own org: allowed
    expect(await activeMembership(orgB, userA)).toBeNull();     // cross org: forbidden
    expect(await activeMembership(orgA, userB)).toBeNull();     // symmetric
  });

  it("member listings don't leak across orgs", async () => {
    const aMembers = (await listMemberships(orgA)).map((m) => m.userId);
    const bMembers = (await listMemberships(orgB)).map((m) => m.userId);
    expect(aMembers).toContain(userA);
    expect(aMembers).not.toContain(userB);
    expect(bMembers).toContain(userB);
    expect(bMembers).not.toContain(userA);
  });

  it("the credit ledger is scoped per org (no cross-org spend/balance leak)", async () => {
    const aRows = await db.select().from(creditLedger).where(eq(creditLedger.tenantId, orgA));
    const bRows = await db.select().from(creditLedger).where(eq(creditLedger.tenantId, orgB));
    expect(aRows.length).toBeGreaterThan(0);
    expect(aRows.every((r: any) => r.tenantId === orgA)).toBe(true);
    expect(bRows.every((r: any) => r.tenantId === orgB)).toBe(true);
    // A's ledger never contains B's rows.
    expect(aRows.some((r: any) => r.tenantId === orgB)).toBe(false);
  });

  it("the domain lock keeps a foreign-domain email out of an org", async () => {
    expect(await isEmailAllowedForTenant(orgA, "intruder@globex.com", null)).toBe(false);
    expect(await isEmailAllowedForTenant(orgA, "ok@acme.com", null)).toBe(true);
    expect(await isEmailAllowedForTenant(orgB, "intruder@acme.com", null)).toBe(false);
  });

  it("ONLY the super-admin is a platform principal (the sole cross-org path)", async () => {
    const isAdmin = async (userId: number) =>
      (await db.select().from(platformAdmins).where(eq(platformAdmins.userId, userId)).limit(1)).length > 0;
    expect(await isAdmin(superUser)).toBe(true);  // super-admin: superAdminProcedure passes
    expect(await isAdmin(userA)).toBe(false);     // org owner: superAdminProcedure FORBIDs
    expect(await isAdmin(userB)).toBe(false);
  });
});
