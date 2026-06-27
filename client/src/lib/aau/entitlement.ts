import type { HubUser } from "@/lib/aster";

// Super-admin / operator accounts get FULL access to every gated hub surface — Plus features AND
// child film — for testing + operations (operator-directed 2026-06-27: "all full access"). This is
// the operator applying the gates to their OWN verified account; it never opens a gate for any other
// viewer. Note the child-film case is still safe re: Copilot #159 — the verified Film state loads
// reels from a gated server source (not yet wired) and carries ZERO child data in the bundle, so
// unlocking it for the operator just shows the honest "no reels yet" state, not hardcoded minors.
// Email match is case-insensitive. (Move to a server-side role claim when auth roles are wired.)
const SUPER_ADMIN_EMAILS = ["frank@astersports.co"];
function isSuperAdmin(user?: HubUser | null): boolean {
  const email = user?.email?.trim().toLowerCase();
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
// guardian verification is wired, so this is false for everyone EXCEPT the super-admin — Film
// renders its locked state and exposes no named minor or reel to an unverified viewer. It flips
// true for a normal account only when both are wired + consented.
export function canAccessChild(user?: HubUser | null): boolean {
  if (isSuperAdmin(user)) return true; // operator full access (own verified account)
  return false; // verified-guardian + entitlement not wired — owner-applied child-data gate
}
