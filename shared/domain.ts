/**
 * Domain-based membership restriction helpers.
 * Used by both server (validation) and client (UI hints).
 *
 * Multi-domain (org-redesign step 4): an org's domain lock is a SET of domains.
 * A join/invite is allowed if the joiner's email domain is in the set (or there's
 * an explicit per-email invite). On org creation the lock auto-seeds from the
 * OWNER's email domain — UNLESS that's a PUBLIC email domain (gmail/outlook/…),
 * in which case NO lock is auto-set (invite-only). Never auto-lock a public
 * domain — it would let any user on that public provider join the org.
 */

/**
 * Public / consumer email domains that must NEVER be used as an auto domain lock.
 * The load-bearing guard for auto-set (spec §4). Lowercase, no leading "@".
 */
export const PUBLIC_EMAIL_DOMAINS: ReadonlySet<string> = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  "yahoo.com",
  "ymail.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "pm.me",
  "gmx.com",
  "gmx.net",
  "zoho.com",
  "yandex.com",
  "mail.com",
  "fastmail.com",
]);

/** Normalize a domain or "@domain" / full email into a bare lowercase domain. */
export function normalizeDomain(input: string | null | undefined): string {
  if (!input) return "";
  let s = input.toLowerCase().trim();
  if (s.includes("@")) s = s.slice(s.lastIndexOf("@") + 1); // accept full emails too
  return s.replace(/^@/, "").trim();
}

/** Extract the domain from an email address (lowercased), or "" if malformed. */
export function extractDomain(email: string): string {
  const parts = email.toLowerCase().trim().split("@");
  return parts.length === 2 && parts[1] ? parts[1] : "";
}

/** True if the domain is a public/consumer provider (never auto-lockable). */
export function isPublicEmailDomain(domain: string | null | undefined): boolean {
  return PUBLIC_EMAIL_DOMAINS.has(normalizeDomain(domain));
}

/**
 * The domain to auto-seed an org's lock from, given the owner's email — or null
 * when the owner is on a public provider (→ no auto lock; the org is invite-only).
 */
export function autoDomainLockForOwnerEmail(email: string | null | undefined): string | null {
  const domain = extractDomain(email ?? "");
  if (!domain || isPublicEmailDomain(domain)) return null;
  return domain;
}

/**
 * SET-aware membership check: is `email` allowed by the org's domain set?
 *  - empty/absent set  → true (no domain lock; explicit per-email invites still
 *    govern who actually gets added — parity with the legacy single-domain null).
 *  - non-empty set     → true iff the email's domain is one of the set.
 */
export function emailAllowedForDomains(
  email: string | null | undefined,
  allowedDomains: ReadonlyArray<string> | null | undefined
): boolean {
  const set = (allowedDomains ?? []).map(normalizeDomain).filter(Boolean);
  if (set.length === 0) return true;
  if (!email) return false;
  const emailDomain = extractDomain(email);
  return !!emailDomain && set.includes(emailDomain);
}

/**
 * Legacy single-domain check (kept for back-compat with callers/data still on
 * tenants.allowedEmailDomain). If `allowedDomain` is null/empty, all emails are
 * allowed. Prefer emailAllowedForDomains for new code.
 */
export function emailAllowedForDomain(
  email: string | null | undefined,
  allowedDomain: string | null | undefined
): boolean {
  if (!allowedDomain) return true;
  if (!email) return false;
  const normalizedEmail = email.toLowerCase().trim();
  const normalizedDomain = normalizeDomain(allowedDomain);
  return normalizedEmail.endsWith(`@${normalizedDomain}`);
}
