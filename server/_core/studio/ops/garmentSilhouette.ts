/**
 * Garment silhouette from instance masks — the boundary densityRedistribute (v2)
 * uses to lay out + clip relocated motifs.
 *
 * WHY NOT combined_mask: SAM2 auto-segmentation's combined_mask unions EVERY
 * segment it found, including background/wall segments on a product photo. Using it
 * as the garment silhouette let v2 place survivor motifs OFF the garment (observed:
 * floral motifs composited onto the backdrop beside a skirt). combined_mask is a fine
 * base-cloth SAMPLING raster (sam2Provider.fabricFromSegment) but a poor garment OUTLINE.
 *
 * The motif INSTANCES (individual_masks, after the >20% giant-ground filter) are
 * reliably ON the garment — print motifs don't land on the wall. So derive the
 * silhouette from the CONVEX HULL of the instance footprints: the smallest convex
 * region spanning every motif. This (a) excludes the background (the hull is bounded
 * by the garment's own outermost motifs), and (b) crucially FILLS the gaps between
 * motif clusters, so blue-noise redistribution spreads survivors evenly across the
 * whole print area instead of bunching them back into the original dense sections.
 * Background-independent (uses motif positions, not backdrop colour).
 *
 * A hull slightly over-covers a concave garment outline; for typical apparel panels
 * (skirts, shirt fronts) that is negligible, and the composite still clips to it.
 *
 * Pure + deterministic: same instances -> identical silhouette. No network, no model.
 */
import type { InstanceMask, RasterMask } from "../../masking/types";

interface Pt { x: number; y: number }

/** >0 if o->a->b turns counter-clockwise. */
function cross(o: Pt, a: Pt, b: Pt): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

/** Andrew's monotone-chain convex hull. Returns CCW hull vertices (no collinear
 *  interior points), or [] when fewer than 3 distinct points are given. */
function convexHull(points: Pt[]): Pt[] {
  const pts = points.slice().sort((a, b) => a.x - b.x || a.y - b.y);
  const uniq: Pt[] = [];
  for (const p of pts) {
    const last = uniq[uniq.length - 1];
    if (!last || last.x !== p.x || last.y !== p.y) uniq.push(p);
  }
  if (uniq.length < 3) return [];
  const lower: Pt[] = [];
  for (const p of uniq) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Pt[] = [];
  for (let i = uniq.length - 1; i >= 0; i--) {
    const p = uniq[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  const hull = lower.concat(upper);
  return hull.length >= 3 ? hull : [];
}

/** Scanline-fill a convex polygon into a binary raster (255 inside). */
function fillConvexPolygon(hull: Pt[], width: number, height: number): Uint8Array {
  const data = new Uint8Array(width * height);
  let ymin = Infinity, ymax = -Infinity;
  for (const p of hull) { if (p.y < ymin) ymin = p.y; if (p.y > ymax) ymax = p.y; }
  const yLo = Math.max(0, Math.floor(ymin));
  const yHi = Math.min(height - 1, Math.ceil(ymax));
  for (let y = yLo; y <= yHi; y++) {
    const yc = y + 0.5;
    let xL = Infinity, xR = -Infinity;
    for (let i = 0; i < hull.length; i++) {
      const a = hull[i], b = hull[(i + 1) % hull.length];
      // edge crosses the scanline yc?
      if ((a.y <= yc && b.y > yc) || (b.y <= yc && a.y > yc)) {
        const x = a.x + ((yc - a.y) / (b.y - a.y)) * (b.x - a.x);
        if (x < xL) xL = x;
        if (x > xR) xR = x;
      }
    }
    if (xR < xL) continue;
    const x0 = Math.max(0, Math.round(xL));
    const x1 = Math.min(width - 1, Math.round(xR));
    const base = y * width;
    for (let x = x0; x <= x1; x++) data[base + x] = 255;
  }
  return data;
}

/**
 * Build the garment silhouette as the filled convex hull of the instance footprints.
 * Returns null when there are too few instances to form a hull (caller then keeps the
 * combined_mask boundary). Each instance contributes its bbox corners so the hull spans
 * each motif's extent, not just its centre.
 */
export function garmentSilhouetteFromInstances(
  instances: InstanceMask[],
  width: number,
  height: number
): RasterMask | null {
  if (width <= 0 || height <= 0 || instances.length === 0) return null;
  const pts: Pt[] = [];
  for (const inst of instances) {
    const b = inst.bbox;
    const x0 = b.x * width, y0 = b.y * height;
    const x1 = (b.x + b.w) * width, y1 = (b.y + b.h) * height;
    pts.push({ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x0, y: y1 }, { x: x1, y: y1 });
  }
  const hull = convexHull(pts);
  if (hull.length < 3) return null;
  return { width, height, data: fillConvexPolygon(hull, width, height) };
}
