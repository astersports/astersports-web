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
 * APPROACH: morphological CLOSE of the motif-instance union, then fill enclosed holes,
 * then keep the largest connected component.
 *  - The motif INSTANCES are reliably ON the garment, so the union tracks the print area.
 *  - CLOSE (dilate by r, fill, erode by r) bridges the gaps BETWEEN motif clusters into
 *    one solid region (so blue-noise spreads survivors evenly, not bunched in the
 *    original dense sections) WITHOUT a net outward halo (erode undoes the dilation at
 *    the outer boundary). r scales with the motif spacing so it bridges real gaps.
 *  - fillHoles fills bare-ground gaps fully ENCLOSED by the print — but never the OPEN
 *    background beside the garment (a convex hull's failure mode: it bridges straight
 *    across the backdrop at a concave waist, placing motifs off the skirt). This keeps
 *    survivors on the garment.
 *  - largestComponent drops a stray/false detection far from the garment.
 * Background-independent (uses motif positions, not backdrop colour).
 *
 * Pure + deterministic: same instances -> identical silhouette. No network, no model.
 */
import type { InstanceMask, RasterMask } from "../../masking/types";

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** 1-D binary dilation by radius `r` (set if any neighbour within ±r is set). O(n). */
function dilateLine(get: (i: number) => number, set: (i: number, v: number) => void, len: number, r: number): void {
  const leftOk = new Uint8Array(len);
  let last = -1 - r;
  for (let i = 0; i < len; i++) {
    if (get(i) > 127) last = i;
    leftOk[i] = i - last <= r ? 1 : 0;
  }
  let next = len + r;
  for (let i = len - 1; i >= 0; i--) {
    if (get(i) > 127) next = i;
    set(i, leftOk[i] || next - i <= r ? 255 : 0);
  }
}

/** 1-D binary erosion by radius `r` (set only if the nearest UNSET pixel is farther than r). O(n). */
function erodeLine(get: (i: number) => number, set: (i: number, v: number) => void, len: number, r: number): void {
  const leftOk = new Uint8Array(len);
  let lastZero = -1 - r;
  for (let i = 0; i < len; i++) {
    if (get(i) <= 127) lastZero = i;
    leftOk[i] = i - lastZero > r ? 1 : 0;
  }
  let nextZero = len + r;
  for (let i = len - 1; i >= 0; i--) {
    if (get(i) <= 127) nextZero = i;
    set(i, leftOk[i] && nextZero - i > r ? 255 : 0);
  }
}

/** Separable square morphology pass (horizontal then vertical) using `op` per line. */
function morphSquare(
  src: Uint8Array,
  w: number,
  h: number,
  r: number,
  op: (get: (i: number) => number, set: (i: number, v: number) => void, len: number, r: number) => void
): Uint8Array {
  if (r <= 0) return src.slice();
  const horiz = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const base = y * w;
    op((x) => src[base + x], (x, v) => { horiz[base + x] = v; }, w, r);
  }
  const out = new Uint8Array(w * h);
  for (let x = 0; x < w; x++) {
    op((y) => horiz[y * w + x], (y, v) => { out[y * w + x] = v; }, h, r);
  }
  return out;
}

/** Fill interior holes: any 0-pixel NOT 4-connected to the border becomes 255. */
function fillHoles(mask: Uint8Array, w: number, h: number): Uint8Array {
  const n = w * h;
  const bgReachable = new Uint8Array(n);
  const stack = new Uint32Array(n);
  let sp = 0;
  const push = (i: number) => { if (mask[i] <= 127 && !bgReachable[i]) { bgReachable[i] = 1; stack[sp++] = i; } };
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + (w - 1)); }
  while (sp > 0) {
    const idx = stack[--sp];
    const x = idx % w, y = (idx / w) | 0;
    if (x > 0) push(idx - 1);
    if (x < w - 1) push(idx + 1);
    if (y > 0) push(idx - w);
    if (y < h - 1) push(idx + w);
  }
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = mask[i] > 127 || !bgReachable[i] ? 255 : 0;
  return out;
}

/** Keep only the single largest 4-connected component (drops stray islands). */
function largestComponentMask(mask: Uint8Array, w: number, h: number): Uint8Array {
  const n = w * h;
  const visited = new Uint8Array(n);
  const frontier = new Uint32Array(n);
  let best: number[] = [];
  for (let start = 0; start < n; start++) {
    if (mask[start] <= 127 || visited[start]) continue;
    let head = 0, tail = 0;
    frontier[tail++] = start;
    visited[start] = 1;
    const comp: number[] = [];
    while (head < tail) {
      const idx = frontier[head++];
      comp.push(idx);
      const x = idx % w, y = (idx / w) | 0;
      if (x > 0)     { const j = idx - 1; if (mask[j] > 127 && !visited[j]) { visited[j] = 1; frontier[tail++] = j; } }
      if (x < w - 1) { const j = idx + 1; if (mask[j] > 127 && !visited[j]) { visited[j] = 1; frontier[tail++] = j; } }
      if (y > 0)     { const j = idx - w; if (mask[j] > 127 && !visited[j]) { visited[j] = 1; frontier[tail++] = j; } }
      if (y < h - 1) { const j = idx + w; if (mask[j] > 127 && !visited[j]) { visited[j] = 1; frontier[tail++] = j; } }
    }
    if (comp.length > best.length) best = comp;
  }
  const out = new Uint8Array(n);
  for (const i of best) out[i] = 255;
  return out;
}

/** Mark an instance's pixels (raster if dims match, else its bbox rectangle). Returns true if any set. */
function markInstance(mask: Uint8Array, inst: InstanceMask, w: number, h: number): boolean {
  const r = inst.raster;
  if (r && r.width === w && r.height === h) {
    let any = false;
    for (let i = 0; i < w * h; i++) if (r.data[i] > 127) { mask[i] = 255; any = true; }
    return any;
  }
  const x0 = clamp(Math.floor(inst.bbox.x * w), 0, w - 1);
  const y0 = clamp(Math.floor(inst.bbox.y * h), 0, h - 1);
  const x1 = clamp(Math.ceil((inst.bbox.x + inst.bbox.w) * w), x0 + 1, w);
  const y1 = clamp(Math.ceil((inst.bbox.y + inst.bbox.h) * h), y0 + 1, h);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) mask[y * w + x] = 255;
  return true;
}

/**
 * Build the garment silhouette from instance masks via morphological close + hole-fill.
 * Returns null when there are no usable instances (caller keeps the combined_mask boundary).
 *
 * Close radius scales with the estimated motif spacing sqrt(area/N): large enough to bridge
 * the gaps between motif clusters (so the spread is even, not bunched), capped at 12% of the
 * short side so it can't fill a deep garment concavity (which would re-admit the backdrop).
 */
export function garmentSilhouetteFromInstances(
  instances: InstanceMask[],
  width: number,
  height: number
): RasterMask | null {
  if (width <= 0 || height <= 0 || instances.length === 0) return null;
  const union = new Uint8Array(width * height);
  let count = 0;
  for (const inst of instances) if (markInstance(union, inst, width, height)) count++;
  if (count === 0) return null;

  const spacing = Math.sqrt((width * height) / count);
  const radius = clamp(Math.round(1.4 * spacing), 8, Math.round(0.12 * Math.min(width, height)));
  // Close = dilate -> fill enclosed gaps -> erode (no net outward halo).
  const dilated = morphSquare(union, width, height, radius, dilateLine);
  const filled = fillHoles(dilated, width, height);
  const closed = morphSquare(filled, width, height, radius, erodeLine);
  const largest = largestComponentMask(fillHoles(closed, width, height), width, height);
  return { width, height, data: largest };
}

/**
 * Garment mask via border flood-fill background removal — for plain-backdrop product
 * photos. The backdrop is the pixels colour-close to the crop's border ring AND
 * 4-connected to it; the garment is the largest NON-backdrop region, holes filled.
 *
 * Used to CLIP a motif silhouette (densityRedistribute) so a few stray placements can't
 * land on the backdrop beside or above the garment (e.g. motifs floating off a skirt near
 * the hanger): a motif-position silhouette alone can't tell garment from hanger/wall.
 *
 * Fail-safe: returns null when the backdrop isn't plainly separable — it fills <5% or >95%
 * of the crop (busy/non-plain backdrop, or garment ≈ backdrop colour) — so the caller keeps
 * the motif silhouette unchanged. `buffer` is RGBA at width×height.
 */
export function garmentMaskFromImage(buffer: Buffer, width: number, height: number): RasterMask | null {
  const n = width * height;
  if (n === 0 || buffer.length < n * 4) return null;
  // Backdrop reference colour = mean of the border ring.
  let rs = 0, gs = 0, bs = 0, cnt = 0;
  const sample = (i: number) => { const p = i * 4; rs += buffer[p]; gs += buffer[p + 1]; bs += buffer[p + 2]; cnt++; };
  for (let x = 0; x < width; x++) { sample(x); sample((height - 1) * width + x); }
  for (let y = 0; y < height; y++) { sample(y * width); sample(y * width + (width - 1)); }
  const rr = rs / cnt, rg = gs / cnt, rb = bs / cnt;
  const TOL2 = 45 * 45; // squared RGB distance from the backdrop reference
  const nearBackdrop = (i: number): boolean => {
    const p = i * 4;
    const dr = buffer[p] - rr, dg = buffer[p + 1] - rg, db = buffer[p + 2] - rb;
    return dr * dr + dg * dg + db * db <= TOL2;
  };
  const bg = new Uint8Array(n);
  const stack = new Uint32Array(n);
  let sp = 0;
  const push = (i: number) => { if (!bg[i] && nearBackdrop(i)) { bg[i] = 1; stack[sp++] = i; } };
  for (let x = 0; x < width; x++) { push(x); push((height - 1) * width + x); }
  for (let y = 0; y < height; y++) { push(y * width); push(y * width + (width - 1)); }
  while (sp > 0) {
    const idx = stack[--sp];
    const x = idx % width, y = (idx / width) | 0;
    if (x > 0) push(idx - 1);
    if (x < width - 1) push(idx + 1);
    if (y > 0) push(idx - width);
    if (y < height - 1) push(idx + width);
  }
  let bgCount = 0;
  for (let i = 0; i < n; i++) if (bg[i]) bgCount++;
  const frac = bgCount / n;
  if (frac < 0.05 || frac > 0.95) return null; // not a plainly-separable backdrop -> skip
  const fg = new Uint8Array(n);
  for (let i = 0; i < n; i++) fg[i] = bg[i] ? 0 : 255;
  return { width, height, data: fillHoles(largestComponentMask(fg, width, height), width, height) };
}
