// Aster Plus entitlement. Uploading a tournament is a Plus feature — "anyone who pays $20/mo can
// upload" (operator-directed 2026-06-27). The real `is_entitled` flag is the money path (owner-
// applied billing webhook, North Star §6 gate #1) and is NOT wired yet, so today no account is
// entitled and every paid action opens the Plus gate. When billing lands, this reads is_entitled
// for the signed-in account and entitled users reach the feature directly — flipping that source is
// the only change needed here, so the gate is honest now and correct later.
export function isPlusEntitled(): boolean {
  return false; // billing not wired — entitlement enforcement is owner-applied
}

// Child-data access for Film (per-kid reels, named minors, AI review). can_access_child =
// is_entitled AND verified_guardian, with consent + one-tap deletion (North Star §6 gate #3:
// child-data exposure is owner-applied; auto mode never OPENS this gate). Neither entitlement nor
// guardian verification is wired, so this is false — Film renders its locked state and exposes no
// named minor or reel to an unverified viewer. It flips true only when both are wired + consented.
export function canAccessChild(): boolean {
  return false; // verified-guardian + entitlement not wired — owner-applied child-data gate
}
