import { useEffect, useRef, useState } from "react";

/**
 * Fire `isVisible` once the element scrolls into view (one-shot — disconnects
 * after the first intersection). Mirrors the landing page's existing
 * scroll-reveal pattern so new sections animate in the same way.
 */
export function useInView<T extends HTMLElement = HTMLDivElement>(threshold = 0.2) {
  const ref = useRef<T>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      { threshold }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [threshold]);

  return { ref, isVisible };
}
