/**
 * SPIKE eval — generative FLUX.1 Fill vs the CURRENT density fill, on the same removal mask.
 *
 * "Current fill" = LaMa if it returns, else the flat base-cloth fill that densityThin actually
 * falls back to (LaMa's `allenhooo/lama` ref 404s as a community model run without a version, so
 * the live op already uses flat fill — this mirrors that reality). FLUX is the candidate.
 *
 * Requires REPLICATE_API_TOKEN. Test garment only until the sub-processor sign-off.
 *   pnpm eval:fill <image.(png|jpg)> <mask.png> [outPrefix]   (mask: WHITE = erase + refill)
 *
 * Output eval/out/<prefix>-compare.png = ORIGINAL | CURRENT | FLUX (labelled).
 */
import { writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { lamaInfill } from "../server/_core/studio/ops/lamaInfill";
import { fluxFill } from "../server/_core/studio/ops/fluxFill";
import type { RasterMask } from "../server/_core/masking/types";

async function loadRgba(p: string): Promise<{ data: Buffer; width: number; height: number }> {
  // .rotate() applies EXIF orientation so a phone photo uprights — and matches the mask,
  // which makeRemovalMask.mjs also builds from the uprighted image.
  const { data, info } = await sharp(p).rotate().ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

async function loadMask(p: string, width: number, height: number): Promise<RasterMask> {
  const { data } = await sharp(p).resize(width, height, { fit: "fill" }).greyscale().raw().toBuffer({ resolveWithObject: true });
  return { data: new Uint8Array(data.buffer, data.byteOffset, width * height), width, height };
}

/** Flat base-cloth fill: paint the masked region with the mean colour of the DARK (fabric, not
 *  motif) pixels outside the mask. This is what densityThin falls back to when LaMa is unavailable. */
function flatFill(rgba: Buffer, region: RasterMask, width: number, height: number): Buffer {
  const N = width * height;
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < N; i++) {
    if (region.data[i] > 127) continue;
    const p = i * 4, lum = 0.299 * rgba[p] + 0.587 * rgba[p + 1] + 0.114 * rgba[p + 2];
    if (lum < 80) { r += rgba[p]; g += rgba[p + 1]; b += rgba[p + 2]; n++; } // dark = fabric
  }
  const [fr, fg, fb] = n ? [Math.round(r / n), Math.round(g / n), Math.round(b / n)] : [10, 10, 12];
  const out = Buffer.from(rgba);
  for (let i = 0; i < N; i++) {
    if (region.data[i] > 127) { const p = i * 4; out[p] = fr; out[p + 1] = fg; out[p + 2] = fb; out[p + 3] = 255; }
  }
  return out;
}

const toPng = (rgba: Buffer, w: number, h: number) =>
  sharp(rgba, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();

function labelSvg(w: number, text: string): Buffer {
  return Buffer.from(
    `<svg width="${w}" height="70"><rect width="${w}" height="70" fill="black" fill-opacity="0.55"/>` +
    `<text x="20" y="50" font-family="sans-serif" font-size="44" font-weight="bold" fill="white">${text}</text></svg>`
  );
}

async function main() {
  const [imagePath, maskPath, outPrefix = "flux-vs-lama"] = process.argv.slice(2);
  if (!imagePath || !maskPath) { console.error("usage: pnpm eval:fill <image> <mask.png> [outPrefix]"); process.exit(2); }
  if (!process.env.REPLICATE_API_TOKEN) { console.error("Set REPLICATE_API_TOKEN."); process.exit(2); }

  const img = await loadRgba(imagePath);
  const region = await loadMask(maskPath, img.width, img.height);
  const outDir = path.join("eval", "out");
  console.log(`image ${img.width}x${img.height}, mask loaded — running fills…`);

  // CURRENT fill: LaMa if it returns, else the flat fall-back the live op uses.
  let current: Buffer, currentLabel: string;
  try {
    const r = await lamaInfill({ imageRgba: img.data, width: img.width, height: img.height, region });
    current = r.data; currentLabel = "CURRENT (LaMa)";
    console.log("LaMa ok");
  } catch (e) {
    console.warn(`LaMa unavailable (${(e as Error).message.slice(0, 80)}…) → flat fill (the live fall-back)`);
    current = flatFill(img.data, region, img.width, img.height); currentLabel = "CURRENT (flat fill)";
  }

  // FLUX — the candidate. This is the point of the eval; if it dies, fail loudly.
  const t0 = Date.now();
  const flux = (await fluxFill({ imageRgba: img.data, width: img.width, height: img.height, region })).data;
  console.log(`FLUX ok (${Date.now() - t0}ms)`);

  const W = img.width, H = img.height;
  const panel = async (rgba: Buffer, label: string) =>
    sharp(await toPng(rgba, W, H)).composite([{ input: labelSvg(W, label), top: 0, left: 0 }]).png().toBuffer();

  await writeFile(path.join(outDir, `${outPrefix}-flux.png`), await toPng(flux, W, H));
  const compare = await sharp({ create: { width: W * 3, height: H, channels: 4, background: { r: 18, g: 18, b: 18, alpha: 1 } } })
    .composite([
      { input: await panel(img.data, "ORIGINAL"), left: 0, top: 0 },
      { input: await panel(current, currentLabel), left: W, top: 0 },
      { input: await panel(flux, "FLUX (new)"), left: W * 2, top: 0 },
    ])
    .png()
    .toBuffer();
  await writeFile(path.join(outDir, `${outPrefix}-compare.png`), compare);
  await writeFile(path.join(outDir, `${outPrefix}-lama.png`), await toPng(current, W, H));
  console.log(`Wrote eval/out/${outPrefix}-compare.png  (ORIGINAL | ${currentLabel} | FLUX)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
