/**
 * Shared offline mask I/O for the Scale/Density eval runners. Loads truth masks
 * from local PNGs so the harnesses run WITHOUT live SAM2 (mirrors recolorEval's
 * offline posture): a fabric truth-mask PNG, and — for density — an instance
 * label-map PNG where each distinct non-near-black colour is one motif instance.
 *
 * One mask PNG serves two roles per the eval design: it is both the op's
 * `fabric.raster` (production behaviour) AND the metric's `truthMask`, so the
 * background signal (poseBg/bg ΔE) is real rather than structurally zero.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { decodeUpright } from "../../image/decodeUpright";
import { rasterBBox } from "../../masking/sam2Mask";
import type { RasterMask, InstanceMask, BBoxNormalized } from "../../masking/types";

export const EVAL_OUT_DIR = path.resolve("eval/out");

/** Decode a PNG/JPG buffer to raw RGBA at its own dimensions. */
export async function rawRGBA(input: Buffer): Promise<{ data: Buffer; width: number; height: number }> {
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

/**
 * Fabric truth mask: non-near-black (max(r,g,b) > 127) = fabric. Returns the
 * binary RasterMask (0/255) the op needs, the 0/1 membership the metric needs,
 * and the normalized fabric bbox.
 */
export async function loadFabricMask(
  url: string,
  width: number,
  height: number
): Promise<{ raster: RasterMask; membership: Uint8Array; bbox: BBoxNormalized }> {
  const img = await decodeUpright(url);
  if (img.width !== width || img.height !== height) {
    throw new Error(`fabric mask dims ${img.width}x${img.height} != image ${width}x${height} for ${url}`);
  }
  const data = new Uint8Array(width * height);
  const membership = new Uint8Array(width * height);
  for (let i = 0; i < data.length; i++) {
    const p = i * 4;
    const on = Math.max(img.buffer[p], img.buffer[p + 1], img.buffer[p + 2]) > 127;
    data[i] = on ? 255 : 0;
    membership[i] = on ? 1 : 0;
  }
  const raster: RasterMask = { width, height, data };
  const bb = rasterBBox(raster);
  return { raster, membership, bbox: bb ? bb.bbox : { x: 0, y: 0, w: 1, h: 1 } };
}

/**
 * Instance label map: each distinct non-near-black colour = one motif instance.
 * Near-black (max channel <= groundMax) is ground (-1). Returns per-pixel labels
 * (Int32Array; -1 ground, >=0 instance id) for the metric, and InstanceMask[]
 * (raster + bbox) for the op. PNG label maps are lossless, so exact-colour
 * grouping is stable.
 */
export async function loadInstanceLabelMap(
  url: string,
  width: number,
  height: number,
  groundMax = 30
): Promise<{ labels: Int32Array; instances: InstanceMask[] }> {
  const img = await decodeUpright(url);
  if (img.width !== width || img.height !== height) {
    throw new Error(`label map dims ${img.width}x${img.height} != image ${width}x${height} for ${url}`);
  }
  const labels = new Int32Array(width * height).fill(-1);
  const colorToId = new Map<number, number>();
  const idData: Uint8Array[] = [];
  for (let i = 0; i < width * height; i++) {
    const p = i * 4;
    const r = img.buffer[p], g = img.buffer[p + 1], b = img.buffer[p + 2];
    if (Math.max(r, g, b) <= groundMax) continue; // ground
    const key = (r << 16) | (g << 8) | b;
    let id = colorToId.get(key);
    if (id === undefined) {
      id = colorToId.size;
      colorToId.set(key, id);
      idData.push(new Uint8Array(width * height));
    }
    labels[i] = id;
    idData[id][i] = 255;
  }
  const instances: InstanceMask[] = idData.map((d) => {
    const raster: RasterMask = { width, height, data: d };
    const bb = rasterBBox(raster);
    return { bbox: bb ? bb.bbox : { x: 0, y: 0, w: 1, h: 1 }, raster };
  });
  return { labels, instances };
}

/** Save a before/after side-by-side PNG (src raw RGBA, out a PNG buffer). */
export async function saveSideBySide(
  srcRGBA: Buffer,
  width: number,
  height: number,
  outPng: Buffer,
  id: string
): Promise<string> {
  await mkdir(EVAL_OUT_DIR, { recursive: true });
  const srcPng = await sharp(srcRGBA, { raw: { width, height, channels: 4 } }).png().toBuffer();
  const composite = await sharp({
    create: { width: width * 2 + 8, height, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } },
  })
    .composite([
      { input: srcPng, left: 0, top: 0 },
      { input: outPng, left: width + 8, top: 0 },
    ])
    .png()
    .toBuffer();
  const file = path.join(EVAL_OUT_DIR, `${id}.png`);
  await writeFile(file, composite);
  return file;
}
