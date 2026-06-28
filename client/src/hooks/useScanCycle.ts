import { useEffect, useState } from "react";

/**
 * Drives the landing "ASTER-AGENT" live-scan sections: returns an index that
 * advances every `intervalMs` once `active` is true, looping over `length`.
 *
 * Honors prefers-reduced-motion AND reacts to the user toggling it mid-session
 * (subscribes to the MediaQueryList `change` event) — under reduced motion the
 * index stays put (no cycling).
 */
export function useScanCycle(length: number, active: boolean, intervalMs = 2200): number {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (!active || length <= 0) return;
    const mql = window.matchMedia("(prefers-reduced-motion: reduce)");
    let id: number | undefined;

    const stop = () => {
      if (id !== undefined) {
        window.clearInterval(id);
        id = undefined;
      }
    };
    const sync = () => {
      stop();
      if (!mql.matches) {
        id = window.setInterval(() => setIndex((i) => (i + 1) % length), intervalMs);
      }
    };

    sync();
    mql.addEventListener("change", sync);
    return () => {
      stop();
      mql.removeEventListener("change", sync);
    };
  }, [active, length, intervalMs]);

  return index;
}
