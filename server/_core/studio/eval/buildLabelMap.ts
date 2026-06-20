/**
 * Build a density eval INSTANCE LABEL-MAP PNG from SAM2 per-instance masks.
 *
 * Input: one binary mask PNG per motif (white = instance) — exactly the shape
 * `Sam2Client.autoSegment` returns as `individuals`, or SAM2's `individual_masks`.
 * Output: a single PNG where ground is black (0,0,0) and each instance gets a
 * unique BRIGHT colour, so `loadInstanceLabelMap` (groundMax=30, exact-colour
 * grouping) reads it back as N instances. Colour encoding is bijective and
 * always bright: r=255, (g,b) = the instance index — distinct per instance, never
 * near-black, so an instance is never mistaken for ground.
 *
 * Use it to make the density runner turnkey: SAM2 individual_masks -> label map ->
 * density.manifest `labelUrl`. Pairs with the fabric mask (`maskUrl`).
 *
 * CLI:  npx tsx server/_core/studio/eval/buildLabelMap.ts <masksDir> <out.png> [refImage]
 *   masksDir : a directory of per-instance mask PNGs (sorted by filename)
 *   out.png  : where to write the label map
 *   refImage : optional — take dims from this image; else the first mask's dims
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { decodeMaskToRaster } from "../../masking/sam2Mask";

/** Bijective bright colour for instance index i: r=255, g=hi byte, b=lo byte. */
export function instanceColor(i: number): [number, number, number] {
  return [255, (i >> 8) & 0xff, i & 0xff];
}

/**
 * Composite per-instance masks into one label-map PNG (RGBA) at width x height.
 * Later masks win on overlap (deterministic by input order). Ground stays black.
 */
export async function buildInstanceLabelMap(
  masks: Buffer[],
  width: number,
  height: number
): Promise<Buffer> {
  const out = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) out[i * 4 + 3] = 255; // opaque, RGB=0 (ground)

  for (let id = 0; id < masks.length; id++) {
    const raster = await decodeMaskToRaster(masks[id], width, height);
    const [r, g, b] = instanceColor(id);
    for (let p = 0; p < width * height; p++) {
      if (raster.data[p] > 127) {
        out[p * 4] = r; out[p * 4 + 1] = g; out[p * 4 + 2] = b;
      }
    }
  }
  return sharp(out, { raw: { width, height, channels: 4 } }).png().toBuffer();
}

async function main() {
  const [masksDir, outPath, refImage] = process.argv.slice(2);
  if (!masksDir || !outPath) {
    console.log("usage: buildLabelMap.ts <masksDir> <out.png> [refImage]");
    process.exit(1);
  }
  const files = (await readdir(masksDir))
    .filter((f) => /\.(png|jpg|jpeg|webp)$/i.test(f))
    .sort();
  if (files.length === 0) {
    console.log(`No mask images in ${masksDir}.`);
    return;
  }
  const masks = await Promise.all(files.map((f) => readFile(path.join(masksDir, f))));

  const dimsSource = refImage ? await readFile(refImage) : masks[0];
  const meta = await sharp(dimsSource).metadata();
  const width = meta.width!, height = meta.height!;

  const png = await buildInstanceLabelMap(masks, width, height);
  await writeFile(outPath, png);
  console.log(`Wrote label map: ${outPath} (${width}x${height}, ${masks.length} instances)`);
}

if (process.argv[1] && path.basename(process.argv[1]).includes("buildLabelMap")) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
