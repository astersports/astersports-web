// Aster Plus entitlement. Uploading a tournament is a Plus feature — "anyone who pays $20/mo can
// upload" (operator-directed 2026-06-27). The real `is_entitled` flag is the money path (owner-
// applied billing webhook, North Star §6 gate #1) and is NOT wired yet, so today no account is
// entitled and every paid action opens the Plus gate. When billing lands, this reads is_entitled
// for the signed-in account and entitled users reach the feature directly — flipping that source is
// the only change needed here, so the gate is honest now and correct later.
export function isPlusEntitled(): boolean {
  return false; // billing not wired — entitlement enforcement is owner-applied
}
