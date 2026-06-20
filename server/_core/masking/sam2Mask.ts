/**
 * Pure SAM2 mask-assembly helpers: convert mask images (PNG bytes) into the
 * locked RasterMask / InstanceMask seam types. No network — provider-independent
 * and unit-testable. The sam2Provider composes these over the Replicate client.
 */
import sharp from "sharp";
import type { RasterMask, InstanceMask, BBoxNormalized } from "./types";

/** Decode a mask image to a binary RasterMask at the target dims (white = included). */
export async function decodeMaskToRaster(
  maskPng: Buffer,
  width: number,
  height: number
): Promise<RasterMask> {
  const { data, info } = await sharp(maskPng)
    .resize(width, height, { fit: "fill" })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const ch = info.channels;
  const out = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) out[i] = data[i * ch] > 127 ? 255 : 0;
  return { width, height, data: out };
}

/** Normalized bbox + pixel area of the included region, or null if empty. */
export function rasterBBox(raster: RasterMask): { bbox: BBoxNormalized; area: number } | null {
  const { width: W, height: H, data } = raster;
  let xmin = W, xmax = -1, ymin = H, ymax = -1, area = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (data[y * W + x] > 127) {
        if (x < xmin) xmin = x; if (x > xmax) xmax = x;
        if (y < ymin) ymin = y; if (y > ymax) ymax = y;
        area++;
      }
    }
  }
  if (xmax < 0) return null;
  return {
    bbox: { x: xmin / W, y: ymin / H, w: (xmax - xmin + 1) / W, h: (ymax - ymin + 1) / H },
    area,
  };
}

/**
 * Assemble InstanceMask[] from per-instance mask images, dropping specks below
 * `minAreaPx`. Larger instances first (stable, deterministic by area then bbox).
 */
export async function instancesFromMasks(
  maskPngs: Buffer[],
  width: number,
  height: number,
  minAreaPx = 200
): Promise<InstanceMask[]> {
  const items: Array<{ inst: InstanceMask; area: number }> = [];
  for (const png of maskPngs) {
    const raster = await decodeMaskToRaster(png, width, height);
    const bb = rasterBBox(raster);
    if (!bb || bb.area < minAreaPx) continue;
    items.push({ inst: { bbox: bb.bbox, raster }, area: bb.area });
  }
  items.sort((a, b) => b.area - a.area || a.inst.bbox.x - b.inst.bbox.x || a.inst.bbox.y - b.inst.bbox.y);
  return items.map((i) => i.inst);
}
