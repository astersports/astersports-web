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
 * silhouette from where the motifs actually are: union the instance bboxes, then
 * morphologically CLOSE with a radius scaled to the motif spacing (bridges the
 * inter-motif gaps into one solid print region without a net outward halo), fill
 * interior holes, and keep the single largest connected component (drops far-flung
 * stray detections). Background-independent (uses motif positions, not backdrop
 * colour), so it holds on busy/on-model backgrounds too.
 *
 * Pure + deterministic: same instances -> identical silhouette. No network, no model.
 */
import type { InstanceMask, RasterMask } from "../../masking/types";

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** 1-D binary dilation by radius `r` (set if any neighbour within ±r is set). O(n)
 *  via nearest-set-left then nearest-set-right — no per-pixel window scan. */
function dilateLine(get: (i: number) => number, set: (i: number, v: number) => void, len: number, r: number): void {
  const leftOk = new Uint8Array(len);
  let last = -1 - r; // sentinel: distance > r
  for (let i = 0; i < len; i++) {
    if (get(i) > 127) last = i;
    leftOk[i] = i - last <= r ? 1 : 0;
  }
  let next = len + r; // sentinel
  for (let i = len - 1; i >= 0; i--) {
    if (get(i) > 127) next = i;
    set(i, leftOk[i] || next - i <= r ? 255 : 0);
  }
}

/** 1-D binary erosion by radius `r` (set only if ALL neighbours within ±r are set,
 *  i.e. the nearest UNSET pixel is farther than r). O(n), mirror of dilateLine. */
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

/** Morphological close: dilate by r then erode by r (bridges gaps <= 2r, no net halo). */
function close(src: Uint8Array, w: number, h: number, r: number): Uint8Array {
  return morphSquare(morphSquare(src, w, h, r, dilateLine), w, h, r, erodeLine);
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

/** Mark an instance's pixels (raster if dims match, else its bbox rectangle). */
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
 * Build the garment silhouette from instance masks. Returns null when there are no
 * usable instances — callers then keep the combined_mask boundary.
 *
 * Close radius scales with the estimated motif spacing sqrt(area/N): big enough to
 * bridge neighbouring motifs (2r > spacing), capped at 15% of the short side so a
 * sparse layout can't balloon far past the garment edge.
 */
export function garmentSilhouetteFromInstances(
  instances: InstanceMask[],
  width: number,
  height: number
): RasterMask | null {
  if (width <= 0 || height <= 0 || instances.length === 0) return null;
  const n = width * height;
  const union = new Uint8Array(n);
  let count = 0;
  for (const inst of instances) if (markInstance(union, inst, width, height)) count++;
  if (count === 0) return null;

  const spacing = Math.sqrt((width * height) / count);
  const radius = clamp(Math.round(0.75 * spacing), 4, Math.round(0.15 * Math.min(width, height)));
  const closed = close(union, width, height, radius);
  const filled = fillHoles(closed, width, height);
  const largest = largestComponentMask(filled, width, height);
  return { width, height, data: largest };
}
