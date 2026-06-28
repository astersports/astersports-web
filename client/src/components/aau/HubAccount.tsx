import { useEffect, useState } from "react";
import { LogIn } from "lucide-react";
import { signInWithGoogle, signOutHub, type HubUser } from "@/lib/aster";

// Account control for the hub top bar. Signed out → a "Sign in" pill that kicks off the
// Google OAuth redirect (account-synced tracking — your teams follow you across devices).
// Signed in → an avatar that opens a small menu to sign out. Tracking works without an
// account, so this is an upgrade, never a gate.
export default function HubAccount({ user }: { user: HubUser | null }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  // Escape closes the open menu (keyboard parity with the click-away backdrop).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!user) {
    return (
      <button
        type="button"
        disabled={busy}
        onClick={() => { setBusy(true); signInWithGoogle().catch(() => setBusy(false)); }}
        aria-label={busy ? "Signing in" : "Sign in with Google"}
        className="as-press inline-flex min-h-[44px] items-center gap-1.5 rounded-full border border-[#E2E8F0] bg-[#FFFFFF] px-3 py-[6px] text-[17.6px] font-semibold text-[#374151] disabled:opacity-60"
      >
        <LogIn className="h-[13px] w-[13px]" aria-hidden="true" /> {busy ? "Signing in…" : "Sign in"}
      </button>
    );
  }

  const initial = (user.name ?? user.email ?? "?").trim().charAt(0).toUpperCase();
  return (
    <div className="relative">
      {/* 44px hit area wraps the 28px gold avatar so the tap target meets the floor. */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Account menu"
        aria-haspopup="menu"
        aria-expanded={open}
        className="as-press grid h-[44px] w-[44px] place-items-center rounded-full"
      >
        <span className="grid h-7 w-7 place-items-center overflow-hidden rounded-full bg-[linear-gradient(135deg,#E8902A,#F6CC55)] text-[19.2px] font-bold text-[#1a1206]">
          {user.avatar ? <img src={user.avatar} alt="" aria-hidden="true" className="h-7 w-7 rounded-full object-cover" /> : initial}
        </span>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div role="menu" aria-label="Account" className="absolute right-0 top-[46px] z-50 w-48 overflow-hidden rounded-[12px] border border-[#E2E8F0] bg-[#FFFFFF] p-1 shadow-[0_12px_30px_-12px_rgba(0,0,0,0.18)]">
            <div className="px-3 py-2">
              <div className="truncate text-[19.2px] font-semibold text-[#1A1D23]">{user.name ?? "Signed in"}</div>
              {user.email && <div className="truncate text-[16px] text-[#4B5563]">{user.email}</div>}
            </div>
            <button
              type="button"
              role="menuitem"
              onClick={() => { setOpen(false); void signOutHub(); }}
              className="as-press min-h-[44px] w-full rounded-[8px] px-3 py-2 text-left text-[19.2px] text-[#DC2626] hover:bg-[rgba(255,107,94,0.08)]"
            >
              Sign out
            </button>
          </div>
        </>
      )}
    </div>
  );
}
