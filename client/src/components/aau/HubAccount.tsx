import { useState } from "react";
import { LogIn } from "lucide-react";
import { signInWithGoogle, signOutHub, type HubUser } from "@/lib/aster";

// Account control for the hub top bar. Signed out → a "Sign in" pill that kicks off the
// Google OAuth redirect (account-synced tracking — your teams follow you across devices).
// Signed in → an avatar that opens a small menu to sign out. Tracking works without an
// account, so this is an upgrade, never a gate.
export default function HubAccount({ user }: { user: HubUser | null }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!user) {
    return (
      <button
        type="button"
        disabled={busy}
        onClick={() => { setBusy(true); signInWithGoogle().catch(() => setBusy(false)); }}
        className="as-press inline-flex items-center gap-1.5 rounded-full border border-[#E2E8F0] bg-[#FFFFFF] px-3 py-[6px] text-[11px] font-semibold text-[#4A5568] disabled:opacity-60"
      >
        <LogIn className="h-[13px] w-[13px]" /> Sign in
      </button>
    );
  }

  const initial = (user.name ?? user.email ?? "?").trim().charAt(0).toUpperCase();
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Account"
        className="as-press grid h-7 w-7 place-items-center overflow-hidden rounded-full bg-[linear-gradient(135deg,#E8902A,#F6CC55)] text-[12px] font-bold text-[#1a1206]"
      >
        {user.avatar ? <img src={user.avatar} alt="" className="h-7 w-7 rounded-full object-cover" /> : initial}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-9 z-50 w-48 overflow-hidden rounded-[12px] border border-[rgba(255,255,255,0.08)] bg-[#FFFFFF] p-1 shadow-[0_12px_30px_-12px_rgba(0,0,0,0.7)]">
            <div className="px-3 py-2">
              <div className="truncate text-[12px] font-semibold text-[#1A1D23]">{user.name ?? "Signed in"}</div>
              {user.email && <div className="truncate text-[10px] text-[#6B7280]">{user.email}</div>}
            </div>
            <button
              type="button"
              onClick={() => { setOpen(false); void signOutHub(); }}
              className="as-press w-full rounded-[8px] px-3 py-2 text-left text-[12px] text-[#DC2626] hover:bg-[rgba(255,107,94,0.08)]"
            >
              Sign out
            </button>
          </div>
        </>
      )}
    </div>
  );
}
