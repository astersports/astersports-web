/**
 * Generate synthetic eval samples for Scale and Density runners.
 *
 * Creates:
 *  - eval/samples/synthetic-scale-raster.png (200x200 all-white = full-image fabric)
 *  - eval/samples/synthetic-density-scene.png (200x200 white bg + 9 colored dots)
 *  - eval/samples/synthetic-density-raster.png (200x200 all-white)
 *  - eval/samples/synthetic-density-instances.png (200x200 each dot = unique color)
 *  - eval/samples/density.manifest.json (3 cases using the synthetic scene)
 *
 * Run: node eval/generateScaleDensitySynthetic.mjs
 */
import sharp from "sharp";
import { writeFileSync } from "node:fs";
import path from "node:path";

const W = 200, H = 200;
const SAMPLES = "eval/samples";

// --- Scale raster: all-white (full image = fabric) ---
const whiteRaster = Buffer.alloc(W * H * 4, 0);
for (let i = 0; i < W * H; i++) {
  whiteRaster[i * 4] = 255;
  whiteRaster[i * 4 + 1] = 255;
  whiteRaster[i * 4 + 2] = 255;
  whiteRaster[i * 4 + 3] = 255;
}
await sharp(whiteRaster, { raw: { width: W, height: H, channels: 4 } })
  .png()
  .toFile(path.join(SAMPLES, "synthetic-scale-raster.png"));
console.log("✓ synthetic-scale-raster.png");

// --- Density scene: white background + 9 colored dots in a 3x3 grid ---
const sceneRGBA = Buffer.alloc(W * H * 4, 0);
// Fill white background.
for (let i = 0; i < W * H; i++) {
  sceneRGBA[i * 4] = 255;
  sceneRGBA[i * 4 + 1] = 255;
  sceneRGBA[i * 4 + 2] = 255;
  sceneRGBA[i * 4 + 3] = 255;
}

// Instance label image: black background, each dot = unique color.
const labelsRGBA = Buffer.alloc(W * H * 4, 0);
for (let i = 0; i < W * H; i++) labelsRGBA[i * 4 + 3] = 255; // opaque black

// 9 dots in a 3x3 grid, radius 12px each.
const DOT_RADIUS = 12;
const instanceColors = [
  [255, 0, 0], [0, 255, 0], [0, 0, 255],
  [255, 255, 0], [255, 0, 255], [0, 255, 255],
  [128, 0, 0], [0, 128, 0], [0, 0, 128],
];
const dotColor = [220, 80, 120]; // pink-ish motifs on white ground

for (let row = 0; row < 3; row++) {
  for (let col = 0; col < 3; col++) {
    const idx = row * 3 + col;
    const cx = Math.round(40 + col * 60);
    const cy = Math.round(40 + row * 60);
    const [lr, lg, lb] = instanceColors[idx];

    for (let y = cy - DOT_RADIUS; y <= cy + DOT_RADIUS; y++) {
      for (let x = cx - DOT_RADIUS; x <= cx + DOT_RADIUS; x++) {
        if (x < 0 || x >= W || y < 0 || y >= H) continue;
        const dx = x - cx, dy = y - cy;
        if (dx * dx + dy * dy <= DOT_RADIUS * DOT_RADIUS) {
          const p = (y * W + x) * 4;
          // Scene: pink dot.
          sceneRGBA[p] = dotColor[0];
          sceneRGBA[p + 1] = dotColor[1];
          sceneRGBA[p + 2] = dotColor[2];
          // Labels: unique color per instance.
          labelsRGBA[p] = lr;
          labelsRGBA[p + 1] = lg;
          labelsRGBA[p + 2] = lb;
        }
      }
    }
  }
}

await sharp(sceneRGBA, { raw: { width: W, height: H, channels: 4 } })
  .png()
  .toFile(path.join(SAMPLES, "synthetic-density-scene.png"));
console.log("✓ synthetic-density-scene.png");

await sharp(whiteRaster, { raw: { width: W, height: H, channels: 4 } })
  .png()
  .toFile(path.join(SAMPLES, "synthetic-density-raster.png"));
console.log("✓ synthetic-density-raster.png");

await sharp(labelsRGBA, { raw: { width: W, height: H, channels: 4 } })
  .png()
  .toFile(path.join(SAMPLES, "synthetic-density-instances.png"));
console.log("✓ synthetic-density-instances.png");

// --- Density manifest ---
const densityManifest = [
  {
    id: "synthetic-density-30",
    imageUrl: "eval/samples/synthetic-density-scene.png",
    percent: 30,
    bbox: { x: 0, y: 0, w: 1, h: 1 },
    rasterUrl: "eval/samples/synthetic-density-raster.png",
    instanceLabelsUrl: "eval/samples/synthetic-density-instances.png",
    truthMaskUrl: "eval/samples/synthetic-density-raster.png",
    note: "Synthetic: 9 dots, remove 30% (~3 dots). Full-image raster."
  },
  {
    id: "synthetic-density-50",
    imageUrl: "eval/samples/synthetic-density-scene.png",
    percent: 50,
    bbox: { x: 0, y: 0, w: 1, h: 1 },
    rasterUrl: "eval/samples/synthetic-density-raster.png",
    instanceLabelsUrl: "eval/samples/synthetic-density-instances.png",
    truthMaskUrl: "eval/samples/synthetic-density-raster.png",
    note: "Synthetic: 9 dots, remove 50% (~5 dots). Tests evenness on small grid."
  },
  {
    id: "synthetic-density-0",
    imageUrl: "eval/samples/synthetic-density-scene.png",
    percent: 0,
    bbox: { x: 0, y: 0, w: 1, h: 1 },
    rasterUrl: "eval/samples/synthetic-density-raster.png",
    instanceLabelsUrl: "eval/samples/synthetic-density-instances.png",
    note: "Synthetic: passthrough — percent=0, removed=0."
  }
];
writeFileSync(path.join(SAMPLES, "density.manifest.json"), JSON.stringify(densityManifest, null, 2) + "\n");
console.log("✓ density.manifest.json");
console.log("\nDone. Run the eval runners:");
console.log("  npx tsx server/_core/studio/eval/scaleEval.ts");
console.log("  npx tsx server/_core/studio/eval/densityEval.ts");
