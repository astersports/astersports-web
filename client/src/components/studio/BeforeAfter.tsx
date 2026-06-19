import { useRef, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";

interface Props {
  beforeUrl: string;
  afterUrl: string;
  onDownload?: () => void;
}

/** Side-by-side / slider before-after comparison with mobile-safe containment. */
export default function BeforeAfter({ beforeUrl, afterUrl, onDownload }: Props) {
  const [pos, setPos] = useState(50);
  const ref = useRef<HTMLDivElement>(null);

  const move = useCallback((clientX: number) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, clientX - rect.left));
    setPos((x / rect.width) * 100);
  }, []);

  return (
    <div className="w-full max-w-full overflow-hidden space-y-3">
      <div
        ref={ref}
        className="relative aspect-[3/4] w-full max-w-full select-none overflow-hidden rounded-xl border bg-muted touch-none"
        onMouseMove={(e) => e.buttons === 1 && move(e.clientX)}
        onMouseDown={(e) => move(e.clientX)}
        onTouchMove={(e) => {
          e.preventDefault();
          move(e.touches[0].clientX);
        }}
        onTouchStart={(e) => {
          e.preventDefault();
          move(e.touches[0].clientX);
        }}
      >
        {/* After image (full width behind) */}
        <img src={afterUrl} alt="After" className="absolute inset-0 h-full w-full object-contain" />

        {/* Before image (clipped to slider position) */}
        <div className="absolute inset-0 overflow-hidden" style={{ width: `${pos}%` }}>
          <img
            src={beforeUrl}
            alt="Before"
            className="absolute inset-0 h-full w-full object-contain"
            style={{ width: ref.current?.clientWidth ?? "100%" }}
          />
        </div>

        {/* Slider line + handle */}
        <div
          className="absolute inset-y-0 w-0.5 bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.2)]"
          style={{ left: `${pos}%` }}
        >
          <div className="absolute top-1/2 left-1/2 grid h-8 w-8 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-white text-xs font-bold text-foreground shadow">
            ↔
          </div>
        </div>

        {/* Labels */}
        <span className="absolute left-2 top-2 rounded bg-black/60 px-2 py-0.5 text-xs font-medium text-white">
          Before
        </span>
        <span className="absolute right-2 top-2 rounded bg-primary/90 px-2 py-0.5 text-xs font-medium text-primary-foreground">
          After
        </span>
      </div>

      {/* Range slider fallback for accessibility */}
      <input
        type="range"
        min={0}
        max={100}
        value={pos}
        onChange={(e) => setPos(Number(e.target.value))}
        className="w-full accent-primary"
      />

      {onDownload && (
        <Button variant="outline" size="sm" className="w-full bg-card" onClick={onDownload}>
          <Download className="mr-2 h-4 w-4" /> Download result
        </Button>
      )}
    </div>
  );
}
