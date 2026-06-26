/**
 * Visual montage: "Even re-space" (v2 densityRedistribute) vs "Thin in place"
 * (v1 densityThin) at 0/30/50/70% density, on a garment-like synthetic (dark
 * ground + ~80 bright ditsy motifs inside a skirt-ish silhouette).
 *
 * Output: a single labelled grid PNG (2 mode-rows × 4 percent-cols) so the
 * perceptual difference between adjacent density steps is directly comparable
 * across the two layout modes. No Replicate / SAM2 needed — drives the real ops
 * on locally-built rasters.
 *
 * Run: cd /home/user/astersports-web && npx tsx scripts/density-mode-montage.ts
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { decodeUpright } from "../server/_core/image/decodeUpright";
import { densityRedistribute } from "../server/_core/studio/ops/densityRedistribute";
import { densityThin } from "../server/_core/studio/ops/densityThin";
import { loadFabricMask, loadInstanceLabelMap } from "../server/_core/studio/eval/evalMaskIO";
import type { FabricMask } from "../server/_core/masking/types";

const OUT = path.resolve("eval/out");
const W = 260, H = 360;
const GROUND: [number, number, number] = [18, 18, 26];           // near-black cloth
const PETAL: Array<[number, number, number]> = [                 // ditsy floral palette
  [232, 156, 178], [222, 140, 165], [150, 182, 230], [120, 160, 225],
];

// Deterministic LCG so the fixture is byte-stable (no Math.random).
function lcg(seed: number) { let s = seed >>> 0; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; }

/** A skirt-ish silhouette: a slightly tapered rectangle with rounded hem. */
function inGarment(x: number, y: number): boolean {
  const top = 40, bot = H - 20;
  if (y < top || y > bot) return false;
  const t = (y - top) / (bot - top);
  const halfW = (88 + 22 * t) ;                  // widens toward the hem
  const cx = W / 2;
  if (Math.abs(x - cx) > halfW) return false;
  if (y > bot - 18) {                            // scalloped hem
    const wob = 6 * Math.abs(Math.sin((x - cx) / 7));
    if (y > bot - wob) return false;
  }
  return true;
}

async function buildFixture() {
  await mkdir(OUT, { recursive: true });
  const scene = Buffer.alloc(W * H * 4);
  const mask = Buffer.alloc(W * H * 4);
  const label = Buffer.alloc(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    const p = i * 4;
    const x = i % W, y = Math.floor(i / W);
    const on = inGarment(x, y);
    scene[p] = on ? GROUND[0] : 245; scene[p + 1] = on ? GROUND[1] : 245; scene[p + 2] = on ? GROUND[2] : 246; scene[p + 3] = 255;
    mask[p] = mask[p + 1] = mask[p + 2] = on ? 255 : 0; mask[p + 3] = 255;
    label[p] = label[p + 1] = label[p + 2] = 0; label[p + 3] = 255;
  }
  // ~80 jittered motifs on a grid, each a small 3-blob floret.
  const rng = lcg(7);
  let id = 0;
  for (let gy = 0; gy < 12; gy++) {
    for (let gx = 0; gx < 8; gx++, id++) {
      const cx = Math.round(28 + gx * (W - 56) / 7 + (rng() - 0.5) * 14);
      const cy = Math.round(54 + gy * (H - 90) / 11 + (rng() - 0.5) * 14);
      if (!inGarment(cx, cy)) continue;
      const col = PETAL[id % PETAL.length];
      const lr = 40 + (id * 7) % 200, lg = 70 + (id * 13) % 160, lb = 90 + (id * 17) % 150; // distinct label color
      const blobs: Array<[number, number, number]> = [[0, 0, 5], [5, -3, 3], [-5, 3, 3]];
      for (const [ox, oy, r] of blobs) {
        for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
          if (dx * dx + dy * dy > r * r) continue;
          const x = cx + ox + dx, y = cy + oy + dy;
          if (x < 0 || x >= W || y < 0 || y >= H || !inGarment(x, y)) continue;
          const p = (y * W + x) * 4;
          scene[p] = col[0]; scene[p + 1] = col[1]; scene[p + 2] = col[2];
          label[p] = lr; label[p + 1] = Math.max(31, lg); label[p + 2] = lb; // keep > groundMax(30)
        }
      }
    }
  }
  const toPng = (b: Buffer) => sharp(b, { raw: { width: W, height: H, channels: 4 } }).png().toBuffer();
  const paths = { scene: path.join(OUT, "g-scene.png"), mask: path.join(OUT, "g-mask.png"), label: path.join(OUT, "g-label.png") };
  await writeFile(paths.scene, await toPng(scene));
  await writeFile(paths.mask, await toPng(mask));
  await writeFile(paths.label, await toPng(label));
  return paths;
}

function labelSvg(text: string, w: number, h = 22): Buffer {
  return Buffer.from(
    `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg"><rect width="${w}" height="${h}" fill="#0b0b12"/>` +
    `<text x="${w / 2}" y="15" font-family="sans-serif" font-size="13" fill="#e6e6ee" text-anchor="middle">${text}</text></svg>`
  );
}

async function main() {
  const fx = await buildFixture();
  const { width, height } = await decodeUpright(fx.scene);
  const { raster, bbox } = await loadFabricMask(fx.mask, width, height);
  const { instances } = await loadInstanceLabelMap(fx.label, width, height);
  const fabric: FabricMask = { bbox, confidence: 1, raster, boundaryRaster: raster, provider: "sam2" };
  const N = instances.length;
  console.log(`fixture: ${N} motifs on a ${width}x${height} silhouette`);

  const percents = [0, 30, 50, 70];
  const modes = [
    { key: "respace", title: "Even re-space (v2)", run: (p: number) => densityRedistribute({ image: { url: fx.scene }, fabric, instances, percent: p }) },
    { key: "inplace", title: "Thin in place (v1)", run: (p: number) => densityThin({ image: { url: fx.scene }, fabric, instances, percent: p }) },
  ];

  const pad = 8, lblH = 22, rowLblW = 150;
  const cellW = width, cellH = height + lblH;
  const gridW = rowLblW + percents.length * (cellW + pad) - pad + pad * 2;
  const gridH = lblH + modes.length * (cellH + pad) - pad + pad * 2;
  const layers: sharp.OverlayOptions[] = [];

  // Column headers (percent).
  for (let c = 0; c < percents.length; c++) {
    const left = pad + rowLblW + c * (cellW + pad);
    layers.push({ input: labelSvg(percents[c] === 0 ? "0% (original)" : `${percents[c]}% reduction`, cellW), top: pad, left });
  }

  for (let m = 0; m < modes.length; m++) {
    const top0 = pad + lblH + m * (cellH + pad);
    layers.push({ input: labelSvg(modes[m].title, rowLblW, cellH), top: top0, left: pad });
    for (let c = 0; c < percents.length; c++) {
      const p = percents[c];
      const res = await modes[m].run(p);
      const removed = (res as { removed: number }).removed;
      const png = await sharp(res.data, { raw: { width, height, channels: 4 } }).png().toBuffer();
      const left = pad + rowLblW + c * (cellW + pad);
      layers.push({ input: png, top: top0, left });
      layers.push({ input: labelSvg(`removed ${removed}/${N}`, cellW), top: top0 + height, left });
      console.log(`${modes[m].key} @ ${p}%: removed ${removed}/${N}`);
    }
  }

  const montage = await sharp({ create: { width: gridW, height: gridH, channels: 4, background: { r: 11, g: 11, b: 18, alpha: 1 } } })
    .composite(layers).png().toBuffer();
  const file = path.join(OUT, "density-mode-montage.png");
  await writeFile(file, montage);
  console.log(`\nmontage -> ${file}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
