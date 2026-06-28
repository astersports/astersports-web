import { useEffect, useRef, useState } from "react";

/**
 * Animate a number from 0 → `target` once `start` flips true. Eases out so the
 * count decelerates into place. Honors prefers-reduced-motion by snapping
 * straight to the target. Returns the current (fractional) value — callers
 * round/format as needed.
 */
export function useCountUp(target: number, durationMs = 1600, start = false): number {
  const [value, setValue] = useState(0);
  const started = useRef(false);

  useEffect(() => {
    if (!start || started.current) return;
    started.current = true;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      setValue(target);
      return;
    }

    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / durationMs);
      const eased = p === 1 ? 1 : 1 - Math.pow(2, -10 * p); // easeOutExpo
      setValue(target * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [start, target, durationMs]);

  return value;
}
