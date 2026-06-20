/**
 * Generate a synthetic test image for the A1 eval harness.
 * Creates a 200x200 image: white background with a pink circle (the "motif").
 * Also creates a manifest with multiple coverage levels to verify the new semantics.
 */
import sharp from "sharp";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const W = 200, H = 200;
const CX = 100, CY = 100, R = 60;

// Create RGBA buffer: white bg + pink circle
const buf = Buffer.alloc(W * H * 4);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    const dx = x - CX, dy = y - CY;
    const inCircle = Math.sqrt(dx * dx + dy * dy) <= R;
    if (inCircle) {
      // Pink: #d98aa6 = rgb(217, 138, 166)
      buf[i] = 217; buf[i + 1] = 138; buf[i + 2] = 166; buf[i + 3] = 255;
    } else {
      // White background
      buf[i] = 255; buf[i + 1] = 255; buf[i + 2] = 255; buf[i + 3] = 255;
    }
  }
}

await mkdir("eval/samples", { recursive: true });
const imgPath = "eval/samples/synthetic-pink-circle.png";
await sharp(buf, { raw: { width: W, height: H, channels: 4 } }).png().toFile(imgPath);
console.log(`Created: ${imgPath}`);

// Create manifest with multiple coverage levels
const manifest = [
  {
    id: "synth-cov100-pink-to-navy",
    imageUrl: imgPath,
    fromColor: "#d98aa6",
    toColor: "#1f2d5a",
    coverage: 100,
    bbox: { x: 0, y: 0, w: 1, h: 1 },
    note: "Synthetic: full coverage, pink circle -> navy"
  },
  {
    id: "synth-cov40-pink-to-navy",
    imageUrl: imgPath,
    fromColor: "#d98aa6",
    toColor: "#1f2d5a",
    coverage: 40,
    bbox: { x: 0, y: 0, w: 1, h: 1 },
    note: "Synthetic: low coverage (40), pink circle -> navy — tests new tolerance semantics"
  },
  {
    id: "synth-cov70-pink-to-navy",
    imageUrl: imgPath,
    fromColor: "#d98aa6",
    toColor: "#1f2d5a",
    coverage: 70,
    bbox: { x: 0, y: 0, w: 1, h: 1 },
    note: "Synthetic: medium coverage (70), pink circle -> navy"
  },
  {
    id: "synth-cov10-pink-to-navy",
    imageUrl: imgPath,
    fromColor: "#d98aa6",
    toColor: "#1f2d5a",
    coverage: 10,
    bbox: { x: 0, y: 0, w: 1, h: 1 },
    note: "Synthetic: minimum coverage (10), pink circle -> navy — tightest tolerance"
  }
];

const manifestPath = "eval/samples/recolor.manifest.json";
await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
console.log(`Created: ${manifestPath}`);
console.log(`\nRun eval with: npx tsx server/_core/studio/eval/recolorEval.ts ${manifestPath}`);
