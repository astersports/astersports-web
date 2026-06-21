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
 * Fraction of total crop area below which an instance is treated as a speck.
 * Measuring the speck floor as a fraction of the crop (rather than an absolute
 * pixel count) keeps the density instance count stable across loose vs. tight
 * crops — a fixed px floor over- or under-filters as the crop scale changes.
 */
const MIN_AREA_FRACTION = 0.0002; // 0.02% of crop area
/** Absolute floor so tiny crops don't drop the threshold to ~0 px. */
const MIN_AREA_FLOOR_PX = 64;

/**
 * Assemble InstanceMask[] from per-instance mask images, dropping specks below
 * the minimum area. Larger instances first (stable, deterministic by area then
 * bbox). When `minAreaPx` is omitted the floor is normalized to the crop size
 * (MIN_AREA_FRACTION of width*height, clamped up to MIN_AREA_FLOOR_PX); pass an
 * explicit value to override.
 */
export async function instancesFromMasks(
  maskPngs: Buffer[],
  width: number,
  height: number,
  minAreaPx?: number
): Promise<InstanceMask[]> {
  const minArea =
    minAreaPx ?? Math.max(MIN_AREA_FLOOR_PX, Math.round(width * height * MIN_AREA_FRACTION));
  const items: Array<{ inst: InstanceMask; area: number }> = [];
  for (const png of maskPngs) {
    const raster = await decodeMaskToRaster(png, width, height);
    const bb = rasterBBox(raster);
    if (!bb || bb.area < minArea) continue;
    items.push({ inst: { bbox: bb.bbox, raster }, area: bb.area });
  }
  items.sort((a, b) => b.area - a.area || a.inst.bbox.x - b.inst.bbox.x || a.inst.bbox.y - b.inst.bbox.y);
  return items.map((i) => i.inst);
}
