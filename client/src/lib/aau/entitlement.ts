import type { HubUser } from "@/lib/aster";

// Super-admin / operator accounts get Plus access (read-side) for testing + operations
// (operator-directed 2026-06-27). The child-data gate is DELIBERATELY excluded — per the architect's
// A5 ruling, Film stays locked until a genuine COPPA-grade guardian-verification + consent design
// exists; the operator does NOT bypass it (it's minors, and a hardcoded-email bypass is not consent).
// Email match is case-insensitive. (Move to a server-side role claim when auth roles are wired.)
const SUPER_ADMIN_EMAILS = ["frank@astersports.co"];
function isSuperAdmin(user?: HubUser | null): boolean {
  const email = user?.email?.trim()?.toLowerCase(); // ?. before toLowerCase: don't throw on null email
  return email != null && SUPER_ADMIN_EMAILS.includes(email);
}

// Aster Plus entitlement. Uploading a tournament is a Plus feature — "anyone who pays $20/mo can
// upload" (operator-directed 2026-06-27). The real `is_entitled` flag is the money path (owner-
// applied billing webhook, North Star §6 gate #1) and is NOT wired yet, so today no account is
// entitled EXCEPT the super-admin and every paid action opens the Plus gate. When billing lands,
// this also reads is_entitled for the signed-in account — flipping that source is the only change
// needed here, so the gate is honest now and correct later.
export function isPlusEntitled(user?: HubUser | null): boolean {
  if (isSuperAdmin(user)) return true; // operator full access
  return false; // billing not wired — entitlement enforcement is owner-applied
}

// Child-data access for Film (per-kid reels, named minors, AI review). can_access_child =
// is_entitled AND verified_guardian, with consent + one-tap deletion (North Star §6 gate #3:
// child-data exposure is owner-applied; auto mode never OPENS this gate). Neither entitlement nor
// guardian verification is wired, so this is false for EVERYONE — including the super-admin. Per the
// architect's A5 ruling Film stays locked until a real COPPA-grade verification + consent design
// exists; a hardcoded-email operator bypass is not consent and would expose minors, so we don't add
// one. It flips true only when entitlement + guardian verification + consent are all wired.
// (The `user` arg is kept for the future per-account check; intentionally unused today.)
export function canAccessChild(_user?: HubUser | null): boolean {
  return false; // child-data gate stays closed for all accounts until COPPA-grade verification lands
}
