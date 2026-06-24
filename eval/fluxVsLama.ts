/**
 * SPIKE eval — FLUX.1 Fill vs LaMa on the SAME image + removal mask, rendered side by side.
 *
 * Settles the one question the model research could NOT resolve from docs: does FLUX.1 Fill
 * actually reconstruct draped / embellished couture fabric cleanly where LaMa smears into blobs?
 * Run it, look at the `-compare.png`, decide with pictures.
 *
 * Requires REPLICATE_API_TOKEN — BOTH providers call Replicate. Use a TEST garment only; routing
 * customer images to FLUX/BFL needs the §1 sub-processor sign-off first.
 *
 * Usage:
 *   REPLICATE_API_TOKEN=... pnpm eval:fill <image.(png|jpg)> <mask.png> [outPrefix]
 *     <image>   the garment photo
 *     <mask>    binary PNG — WHITE where motifs should be erased + refilled, BLACK = keep
 *               (paint one, or export the union of the SAM2 instance masks the app already makes)
 *     outPrefix default "flux-vs-lama" → eval/out/<prefix>-{lama,flux,compare}.png
 *
 * The `-compare.png` is original | LaMa | FLUX, left to right.
 */
import { writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { lamaInfill } from "../server/_core/studio/ops/lamaInfill";
import { fluxFill } from "../server/_core/studio/ops/fluxFill";
import type { RasterMask } from "../server/_core/masking/types";

async function loadRgba(p: string): Promise<{ data: Buffer; width: number; height: number }> {
  // .rotate() applies EXIF orientation so a phone photo is uprighted — and matches the mask,
  // which makeRemovalMask.mjs also builds from the uprighted image.
  const { data, info } = await sharp(p).rotate().ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

async function loadMask(p: string, width: number, height: number): Promise<RasterMask> {
  const { data } = await sharp(p).resize(width, height, { fit: "fill" }).greyscale().raw().toBuffer({ resolveWithObject: true });
  return { data: new Uint8Array(data.buffer, data.byteOffset, width * height), width, height };
}

const toPng = (rgba: Buffer, w: number, h: number) =>
  sharp(rgba, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();

async function main() {
  const [imagePath, maskPath, outPrefix = "flux-vs-lama"] = process.argv.slice(2);
  if (!imagePath || !maskPath) {
    console.error("usage: pnpm eval:fill <image> <mask.png> [outPrefix]");
    process.exit(2);
  }
  if (!process.env.REPLICATE_API_TOKEN) {
    console.error("Set REPLICATE_API_TOKEN — both LaMa and FLUX call Replicate.");
    process.exit(2);
  }

  const img = await loadRgba(imagePath);
  const region = await loadMask(maskPath, img.width, img.height);
  const outDir = path.join("eval", "out");
  console.log(`image ${img.width}x${img.height}, mask loaded — running both fills…`);

  const t0 = Date.now();
  const lama = await lamaInfill({ imageRgba: img.data, width: img.width, height: img.height, region });
  const t1 = Date.now();
  const flux = await fluxFill({ imageRgba: img.data, width: img.width, height: img.height, region });
  const t2 = Date.now();
  console.log(`LaMa ${t1 - t0}ms · FLUX ${t2 - t1}ms`);

  await writeFile(path.join(outDir, `${outPrefix}-lama.png`), await toPng(lama.data, img.width, img.height));
  await writeFile(path.join(outDir, `${outPrefix}-flux.png`), await toPng(flux.data, img.width, img.height));

  // original | LaMa | FLUX
  const compare = await sharp({
    create: { width: img.width * 3, height: img.height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } },
  })
    .composite([
      { input: await toPng(img.data, img.width, img.height), left: 0, top: 0 },
      { input: await toPng(lama.data, img.width, img.height), left: img.width, top: 0 },
      { input: await toPng(flux.data, img.width, img.height), left: img.width * 2, top: 0 },
    ])
    .png()
    .toBuffer();
  await writeFile(path.join(outDir, `${outPrefix}-compare.png`), compare);
  console.log(`Wrote eval/out/${outPrefix}-{lama,flux,compare}.png  (compare = original | LaMa | FLUX)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
