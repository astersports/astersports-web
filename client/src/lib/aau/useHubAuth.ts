// Single source of hub auth state. Drives the tracking store's account/anon mode on every
// auth change (initial load, sign-in redirect return, sign-out) and exposes the current user
// for the sign-in UI. Call ONCE at the always-mounted hub shell so the store stays wired
// across tab switches.

import { useEffect, useState } from "react";
import { getHubUser, onHubAuth, type HubUser } from "@/lib/aster";
import { setAuthUser } from "./trackingStore";

export function useHubAuth(): HubUser | null {
  const [user, setUser] = useState<HubUser | null>(null);
  useEffect(() => {
    let alive = true;
    getHubUser().then((u) => {
      if (!alive) return;
      setUser(u);
      void setAuthUser(u?.id ?? null);
    });
    const off = onHubAuth((u) => {
      setUser(u);
      void setAuthUser(u?.id ?? null);
    });
    return () => { alive = false; off(); };
  }, []);
  return user;
}
