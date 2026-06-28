import { useRef, type CSSProperties, type ReactNode } from "react";

/**
 * Card wrapper with a pointer-tracked spotlight glow (the `.aster-spotlight`
 * layer reads the `--mx`/`--my` custom props this sets on mousemove). Visual
 * only — content stays fully interactive above the glow.
 */
export default function SpotlightCard({
  children,
  className = "",
  style,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  const ref = useRef<HTMLDivElement>(null);

  const handleMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    el.style.setProperty("--mx", `${e.clientX - rect.left}px`);
    el.style.setProperty("--my", `${e.clientY - rect.top}px`);
  };

  return (
    <div ref={ref} onMouseMove={handleMove} className={`aster-spotlight ${className}`} style={style}>
      {children}
    </div>
  );
}
