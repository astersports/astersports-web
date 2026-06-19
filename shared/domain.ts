/**
 * Domain-based membership restriction helpers.
 * Used by both server (validation) and client (UI hints).
 */

/**
 * Returns true if the given email is allowed for the tenant's domain restriction.
 * If `allowedDomain` is null/empty, all emails are allowed.
 */
export function emailAllowedForDomain(
  email: string | null | undefined,
  allowedDomain: string | null | undefined
): boolean {
  if (!allowedDomain) return true;
  if (!email) return false;
  const normalizedEmail = email.toLowerCase().trim();
  const normalizedDomain = allowedDomain.toLowerCase().trim().replace(/^@/, "");
  return normalizedEmail.endsWith(`@${normalizedDomain}`);
}

/**
 * Extract domain from an email address.
 */
export function extractDomain(email: string): string {
  const parts = email.toLowerCase().trim().split("@");
  return parts.length === 2 ? parts[1] : "";
}
