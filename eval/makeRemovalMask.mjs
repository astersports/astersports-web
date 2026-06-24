/**
 * SPIKE helper — build a faithful "thin the print" removal mask from the test garment, locally,
 * with NO model creds. The flowers are the COLOURFUL pixels on the near-black fabric, so we detect
 * motifs by saturation + brightness (excludes black fabric AND white background), then keep a
 * spatially-distributed ~40% of them (checkerboard of cells) to simulate a density reduction.
 *
 * Output: eval/samples/test-garment.mask.png (white = erase + refill, black = keep). The fill eval
 * (eval/fluxVsLama.ts) consumes this against the same image.
 *
 *   node eval/makeRemovalMask.mjs [imageIn] [maskOut]
 */
import { writeFile } from "node:fs/promises";
import sharp from "sharp";

const IMAGE = process.argv[2] || "eval/samples/test-garment.jpeg";
const OUT = process.argv[3] || "eval/samples/test-garment.mask.png";
const CELL = 64;            // checkerboard cell size (px) for spatial thinning
const SAT_MIN = 38;         // min (max-min) chroma to count as a coloured motif
const VAL_MIN = 55;         // exclude near-black fabric
const VAL_MAX = 245;        // exclude blown-out white background
// Garment bbox (fraction of the UPRIGHT image) — excludes the hanger (top) and the white
// background sides, so the fill is tested only on the black floral fabric. Matches the bbox
// generateSam2Mask.mjs uses for this skirt.
const BX0 = 0.26, BX1 = 0.74, BY0 = 0.17, BY1 = 0.93;

const { data, info } = await sharp(IMAGE).rotate().removeAlpha().raw().toBuffer({ resolveWithObject: true });
const { width, height } = info;
const region = Buffer.alloc(width * height);
const [bx0, bx1, by0, by1] = [BX0 * width, BX1 * width, BY0 * height, BY1 * height];

let motif = 0, kept = 0;
for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    if (x < bx0 || x > bx1 || y < by0 || y > by1) continue; // on-garment only
    const p = (y * width + x) * 3;
    const r = data[p], g = data[p + 1], b = data[p + 2];
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const isMotif = max - min >= SAT_MIN && max >= VAL_MIN && max <= VAL_MAX;
    if (!isMotif) continue;
    motif++;
    // spatial thinning: keep motifs only in the "on" cells of a checkerboard (~40% of area)
    const cell = (Math.floor(x / CELL) + Math.floor(y / CELL)) % 5;
    if (cell === 0 || cell === 2) { region[y * width + x] = 255; kept++; }
  }
}

// Dilate ~2px so the whole motif (not just its core) lands inside the fill region.
const mask = await sharp(region, { raw: { width, height, channels: 1 } })
  .blur(1.5)
  .threshold(60)
  .png()
  .toBuffer();
await writeFile(OUT, mask);

const pct = (n) => ((100 * n) / (width * height)).toFixed(2);
console.log(`image ${width}x${height} · motif px ${pct(motif)}% · erase px ${pct(kept)}% → ${OUT}`);
