/**
 * Synthetic fixture generator for the Density v2 (Option B) eval. Emits three
 * PNGs that mirror the offline density-eval inputs:
 *   - <prefix>-scene.png   : textured light ground + a 6×6 grid of identical
 *                            motif dots (36 instances) — the op's input image.
 *   - <prefix>-mask.png    : full-white fabric raster (the op's fabric.raster AND
 *                            the metric's truthMask).
 *   - <prefix>-labels.png  : instance label map — each dot a DISTINCT non-black
 *                            colour (one colour = one motif id), black ground.
 *
 * Written to a gitignored dir (eval/out) so no binary lands in the repo; the eval
 * regenerates them on demand. Deterministic (no RNG) so the eval stays byte-stable.
 */
import { mkdir, writeFile, access } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

export interface FixturePaths {
  scene: string;
  mask: string;
  labels: string;
}

const W = 128, H = 128;
const COLS = 6, ROWS = 6; // 36 instances
const OFF = 14, P = 20, R = 8; // dot grid: centres 14..114, radius 8 -> all inside [0,128)
const MOTIF: [number, number, number] = [200, 80, 90];

function inDot(x: number, y: number, cx: number, cy: number): boolean {
  return (x - cx) ** 2 + (y - cy) ** 2 <= R * R;
}

async function rawToPng(rgba: Buffer, file: string): Promise<void> {
  const png = await sharp(rgba, { raw: { width: W, height: H, channels: 4 } }).png().toBuffer();
  await writeFile(file, png);
}

async function exists(p: string): Promise<boolean> {
  try { await access(p); return true; } catch { return false; }
}

/** Generate (or reuse) the three fixture PNGs under `dir`. */
export async function ensureRedistributeFixture(dir: string, prefix = "redistribute"): Promise<FixturePaths> {
  await mkdir(dir, { recursive: true });
  const paths: FixturePaths = {
    scene: path.join(dir, `${prefix}-scene.png`),
    mask: path.join(dir, `${prefix}-mask.png`),
    labels: path.join(dir, `${prefix}-labels.png`),
  };
  if ((await exists(paths.scene)) && (await exists(paths.mask)) && (await exists(paths.labels))) {
    return paths;
  }

  const scene = Buffer.alloc(W * H * 4);
  const mask = Buffer.alloc(W * H * 4);
  const labels = Buffer.alloc(W * H * 4);

  for (let i = 0; i < W * H; i++) {
    const p = i * 4;
    // Textured light ground (deterministic checker-ish variation).
    scene[p] = 225 + (i % 5) - 2;
    scene[p + 1] = 220 + (i % 3) - 1;
    scene[p + 2] = 205;
    scene[p + 3] = 255;
    // Full-white fabric raster.
    mask[p] = mask[p + 1] = mask[p + 2] = 255; mask[p + 3] = 255;
    // Label map ground = black.
    labels[p] = labels[p + 1] = labels[p + 2] = 0; labels[p + 3] = 255;
  }

  let id = 0;
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++, id++) {
      const cx = OFF + col * P, cy = OFF + row * P;
      // Distinct non-near-black colour per instance (r varies, b fixed at 120).
      const lr = 36 + id * 6, lg = 80, lb = 120;
      for (let y = cy - R; y <= cy + R; y++) {
        for (let x = cx - R; x <= cx + R; x++) {
          if (x < 0 || x >= W || y < 0 || y >= H || !inDot(x, y, cx, cy)) continue;
          const p = (y * W + x) * 4;
          scene[p] = MOTIF[0]; scene[p + 1] = MOTIF[1]; scene[p + 2] = MOTIF[2];
          labels[p] = lr; labels[p + 1] = lg; labels[p + 2] = lb;
        }
      }
    }
  }

  await rawToPng(scene, paths.scene);
  await rawToPng(mask, paths.mask);
  await rawToPng(labels, paths.labels);
  return paths;
}
