/**
 * Fabric pixel membership shared by the recolor op and the eval harness, so both
 * split fabric vs background identically. Uses the raster mask when its dims
 * match the upright image, else the normalized bbox (the bbox-vs-raster
 * difference is the recolor "raster signal" the eval quantifies).
 */
import type { FabricMask } from "../../masking";

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function fabricMembership(
  fabric: FabricMask,
  width: number,
  height: number
): Uint8Array {
  const m = new Uint8Array(width * height);
  const r = fabric.raster;
  if (r && r.width === width && r.height === height) {
    for (let i = 0; i < m.length; i++) m[i] = r.data[i] > 127 ? 1 : 0;
    return m;
  }
  const x0 = clamp(Math.floor(fabric.bbox.x * width), 0, width);
  const y0 = clamp(Math.floor(fabric.bbox.y * height), 0, height);
  const x1 = clamp(Math.ceil((fabric.bbox.x + fabric.bbox.w) * width), 0, width);
  const y1 = clamp(Math.ceil((fabric.bbox.y + fabric.bbox.h) * height), 0, height);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) m[y * width + x] = 1;
  }
  return m;
}
