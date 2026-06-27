/**
 * Multi-domain lock — DB helpers (org-redesign step 4). The set of email domains
 * allowed to join a tenant lives in tenant_domains; the legacy single
 * tenants.allowedEmailDomain is the fallback when a tenant has no rows yet.
 *
 * Enforcement lives in isEmailAllowedForTenant: a tenant with a non-empty domain
 * set only admits emails on those domains; a tenant with an empty set (and no
 * legacy domain) admits any email (explicit per-email invites still govern).
 */
import { eq } from "drizzle-orm";
import { getDb } from "./db";
import { tenantDomains } from "../drizzle/schema";
import { normalizeDomain, emailAllowedForDomains, emailAllowedForDomain } from "../shared/domain";

/** The tenant's allowed-domain set (normalized, lowercased), or [] if none. */
export async function listTenantDomains(tenantId: number): Promise<string[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select({ domain: tenantDomains.domain })
    .from(tenantDomains)
    .where(eq(tenantDomains.tenantId, tenantId));
  return rows.map((r) => r.domain);
}

/**
 * Add domains to a tenant's set (idempotent — skips dups via the unique index).
 * Inputs are normalized + de-duped; blanks dropped. Returns the number of rows
 * ACTUALLY inserted (already-present domains are skipped and not counted).
 */
export async function addTenantDomains(tenantId: number, domains: Array<string | null | undefined>): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const clean = Array.from(new Set(domains.map(normalizeDomain).filter(Boolean)));
  if (clean.length === 0) return 0;
  const rows = clean.map((domain) => ({ tenantId, domain }));
  // onConflictDoNothing on the (tenantId, domain) unique index makes re-adds a no-op;
  // RETURNING yields only the rows genuinely inserted, so the count is accurate.
  const inserted = await db.insert(tenantDomains).values(rows).onConflictDoNothing().returning({ id: tenantDomains.id });
  return inserted.length;
}

/**
 * Is `email` allowed to join the tenant? Uses the multi-domain set when present,
 * else falls back to the legacy single tenants.allowedEmailDomain (so existing
 * orgs that only have the legacy column keep working until migrated).
 */
export async function isEmailAllowedForTenant(
  tenantId: number,
  email: string | null | undefined,
  legacyAllowedDomain: string | null | undefined
): Promise<boolean> {
  const set = await listTenantDomains(tenantId);
  if (set.length > 0) return emailAllowedForDomains(email, set);
  return emailAllowedForDomain(email, legacyAllowedDomain);
}
