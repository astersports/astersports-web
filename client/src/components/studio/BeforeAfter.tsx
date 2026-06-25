import { useRef, useState, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Download, ZoomIn, ZoomOut, Maximize2 } from "lucide-react";

interface Props {
  beforeUrl: string;
  afterUrl: string;
  onDownload?: () => void;
}

/**
 * Side-by-side before/after comparison with synchronized pan & zoom.
 * - Scroll to zoom (both images zoom together)
 * - Drag to pan (both images pan together)
 * - Pinch to zoom on touch devices
 * - Reset button to return to default view
 */
export default function BeforeAfter({ beforeUrl, afterUrl, onDownload }: Props) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  const MIN_ZOOM = 1;
  const MAX_ZOOM = 5;
  const ZOOM_STEP = 0.3;

  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
      setZoom((prev) => {
        const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, prev + delta));
        // Reset pan when zooming back to 1
        if (next <= 1) setPan({ x: 0, y: 0 });
        return next;
      });
    },
    []
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (zoom <= 1) return;
      e.preventDefault();
      setIsDragging(true);
      dragStart.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
    },
    [zoom, pan]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!isDragging) return;
      const dx = e.clientX - dragStart.current.x;
      const dy = e.clientY - dragStart.current.y;
      setPan({ x: dragStart.current.panX + dx, y: dragStart.current.panY + dy });
    },
    [isDragging]
  );

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  // Touch support for pinch zoom and drag
  const lastTouchDist = useRef<number | null>(null);
  const lastTouchCenter = useRef<{ x: number; y: number } | null>(null);

  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (e.touches.length === 2) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        lastTouchDist.current = Math.sqrt(dx * dx + dy * dy);
      } else if (e.touches.length === 1 && zoom > 1) {
        setIsDragging(true);
        dragStart.current = {
          x: e.touches[0].clientX,
          y: e.touches[0].clientY,
          panX: pan.x,
          panY: pan.y,
        };
      }
    },
    [zoom, pan]
  );

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      e.preventDefault();
      if (e.touches.length === 2) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (lastTouchDist.current !== null) {
          const scale = dist / lastTouchDist.current;
          setZoom((prev) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, prev * scale)));
        }
        lastTouchDist.current = dist;
      } else if (e.touches.length === 1 && isDragging) {
        const dx = e.touches[0].clientX - dragStart.current.x;
        const dy = e.touches[0].clientY - dragStart.current.y;
        setPan({ x: dragStart.current.panX + dx, y: dragStart.current.panY + dy });
      }
    },
    [isDragging]
  );

  const handleTouchEnd = useCallback(() => {
    setIsDragging(false);
    lastTouchDist.current = null;
    lastTouchCenter.current = null;
  }, []);

  // Reset when images change
  useEffect(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, [beforeUrl, afterUrl]);

  const resetView = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  const zoomIn = () => setZoom((prev) => Math.min(MAX_ZOOM, prev + ZOOM_STEP));
  const zoomOut = () => {
    setZoom((prev) => {
      const next = Math.max(MIN_ZOOM, prev - ZOOM_STEP);
      if (next <= 1) setPan({ x: 0, y: 0 });
      return next;
    });
  };

  const imageStyle: React.CSSProperties = {
    transform: `scale(${zoom}) translate(${pan.x / zoom}px, ${pan.y / zoom}px)`,
    transition: isDragging ? "none" : "transform 0.15s ease-out",
    transformOrigin: "center center",
  };

  return (
    <div className="w-full max-w-full space-y-3">
      {/* Zoom controls */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8 bg-card"
            onClick={zoomOut}
            disabled={zoom <= MIN_ZOOM}
            aria-label="Zoom out"
          >
            <ZoomOut className="h-4 w-4" />
          </Button>
          <span className="text-xs text-muted-foreground w-12 text-center font-mono">
            {Math.round(zoom * 100)}%
          </span>
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8 bg-card"
            onClick={zoomIn}
            disabled={zoom >= MAX_ZOOM}
            aria-label="Zoom in"
          >
            <ZoomIn className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8 bg-card ml-1"
            onClick={resetView}
            disabled={zoom === 1}
            aria-label="Reset zoom"
          >
            <Maximize2 className="h-4 w-4" />
          </Button>
        </div>
        <p className="hidden text-xs text-muted-foreground sm:block">
          {zoom > 1 ? "Drag to pan • scroll to zoom" : "Scroll to zoom in"}
        </p>
      </div>

      {/* Side-by-side comparison */}
      <div
        ref={containerRef}
        className="grid grid-cols-2 gap-2 w-full"
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        style={{ cursor: zoom > 1 ? (isDragging ? "grabbing" : "grab") : "zoom-in" }}
      >
        {/* Before */}
        <div className="relative aspect-[3/4] overflow-hidden rounded-xl border bg-muted">
          <span className="absolute left-2 top-2 z-10 rounded bg-black/60 px-2 py-0.5 text-xs font-medium text-white">
            Before
          </span>
          <img
            src={beforeUrl}
            alt="Before"
            className="h-full w-full object-contain select-none pointer-events-none"
            style={imageStyle}
            draggable={false}
          />
        </div>

        {/* After */}
        <div className="relative aspect-[3/4] overflow-hidden rounded-xl border border-primary/30 bg-muted">
          <span className="absolute right-2 top-2 z-10 rounded bg-primary/90 px-2 py-0.5 text-xs font-medium text-primary-foreground">
            After
          </span>
          <img
            src={afterUrl}
            alt="After"
            className="h-full w-full object-contain select-none pointer-events-none"
            style={imageStyle}
            draggable={false}
          />
        </div>
      </div>

      {onDownload && (
        <Button variant="outline" size="sm" className="w-full bg-card" onClick={onDownload}>
          <Download className="mr-2 h-4 w-4" /> Download result
        </Button>
      )}
    </div>
  );
}
