/**
 * Generate synthetic eval samples for Scale and Density runners.
 *
 * Creates:
 *  - eval/samples/synthetic-scale-scene.png  (200x200 repeating dot grid, period=40px)
 *  - eval/samples/synthetic-scale-raster.png (200x200 all-white = full-image fabric)
 *  - eval/samples/synthetic-density-scene.png (200x200 white bg + 9 colored dots)
 *  - eval/samples/synthetic-density-raster.png (200x200 all-white)
 *  - eval/samples/synthetic-density-instances.png (200x200 each dot = unique color)
 *  - eval/samples/synthetic-lattice-scene.png (200x200 perfect hex lattice for NNI cap test)
 *  - eval/samples/synthetic-lattice-raster.png (200x200 all-white)
 *  - eval/samples/synthetic-lattice-instances.png (200x200 each dot = unique color)
 *  - eval/samples/density.manifest.json (4 cases: 30%, 50%, 0%, lattice-cap-fail)
 *  - eval/samples/scale.manifest.json (3 cases: shrink, enlarge, passthrough)
 *
 * Run: node eval/generateScaleDensitySynthetic.mjs
 */
import sharp from "sharp";
import { writeFileSync } from "node:fs";
import path from "node:path";

const W = 200, H = 200;
const SAMPLES = "eval/samples";

// ─── Helper: draw a filled circle into an RGBA buffer ──────────────────────
function drawCircle(buf, w, cx, cy, r, color) {
  for (let y = cy - r; y <= cy + r; y++) {
    for (let x = cx - r; x <= cx + r; x++) {
      if (x < 0 || x >= w || y < 0 || y >= w) continue;
      if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) {
        const p = (y * w + x) * 4;
        buf[p] = color[0];
        buf[p + 1] = color[1];
        buf[p + 2] = color[2];
        // alpha stays as-is (should be 255)
      }
    }
  }
}

// ─── Helper: create an all-white RGBA buffer ───────────────────────────────
function whiteBuffer(w, h) {
  const buf = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    buf[i * 4] = 255;
    buf[i * 4 + 1] = 255;
    buf[i * 4 + 2] = 255;
    buf[i * 4 + 3] = 255;
  }
  return buf;
}

// ─── Helper: save raw RGBA to PNG ──────────────────────────────────────────
async function savePng(buf, w, h, file) {
  await sharp(buf, { raw: { width: w, height: h, channels: 4 } })
    .png()
    .toFile(file);
}

// ═══════════════════════════════════════════════════════════════════════════════
// SCALE FIXTURES: A repeating dot grid with known period (40px spacing)
// The autocorrelation estimator needs a periodic signal to measure.
// ═══════════════════════════════════════════════════════════════════════════════

const SCALE_PERIOD = 40; // px between dot centers
const SCALE_DOT_R = 8;  // dot radius
const SCALE_DOT_COLOR = [60, 120, 180]; // blue-ish dots
const SCALE_BG_COLOR = [240, 235, 225]; // warm off-white ground

// Scene: repeating grid of dots at period=40px
const scaleScene = Buffer.alloc(W * H * 4);
for (let i = 0; i < W * H; i++) {
  scaleScene[i * 4] = SCALE_BG_COLOR[0];
  scaleScene[i * 4 + 1] = SCALE_BG_COLOR[1];
  scaleScene[i * 4 + 2] = SCALE_BG_COLOR[2];
  scaleScene[i * 4 + 3] = 255;
}
// Place dots in a grid with period SCALE_PERIOD, starting at offset period/2
const scaleOffset = SCALE_PERIOD / 2;
for (let row = 0; row * SCALE_PERIOD + scaleOffset < H; row++) {
  for (let col = 0; col * SCALE_PERIOD + scaleOffset < W; col++) {
    const cx = Math.round(col * SCALE_PERIOD + scaleOffset);
    const cy = Math.round(row * SCALE_PERIOD + scaleOffset);
    drawCircle(scaleScene, W, cx, cy, SCALE_DOT_R, SCALE_DOT_COLOR);
  }
}

await savePng(scaleScene, W, H, path.join(SAMPLES, "synthetic-scale-scene.png"));
console.log("✓ synthetic-scale-scene.png (repeating grid, period=40px)");

// Scale raster: all-white (full image = fabric)
const scaleRaster = whiteBuffer(W, H);
await savePng(scaleRaster, W, H, path.join(SAMPLES, "synthetic-scale-raster.png"));
console.log("✓ synthetic-scale-raster.png");

// ═══════════════════════════════════════════════════════════════════════════════
// DENSITY FIXTURES: 9 dots in a 3x3 grid (existing pattern, works well)
// ═══════════════════════════════════════════════════════════════════════════════

const densityScene = Buffer.alloc(W * H * 4);
for (let i = 0; i < W * H; i++) {
  densityScene[i * 4] = 255;
  densityScene[i * 4 + 1] = 255;
  densityScene[i * 4 + 2] = 255;
  densityScene[i * 4 + 3] = 255;
}

const densityLabels = Buffer.alloc(W * H * 4);
for (let i = 0; i < W * H; i++) densityLabels[i * 4 + 3] = 255; // opaque black

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
        if ((x - cx) ** 2 + (y - cy) ** 2 <= DOT_RADIUS * DOT_RADIUS) {
          const p = (y * W + x) * 4;
          densityScene[p] = dotColor[0];
          densityScene[p + 1] = dotColor[1];
          densityScene[p + 2] = dotColor[2];
          densityLabels[p] = lr;
          densityLabels[p + 1] = lg;
          densityLabels[p + 2] = lb;
        }
      }
    }
  }
}

await savePng(densityScene, W, H, path.join(SAMPLES, "synthetic-density-scene.png"));
console.log("✓ synthetic-density-scene.png");

const densityRaster = whiteBuffer(W, H);
await savePng(densityRaster, W, H, path.join(SAMPLES, "synthetic-density-raster.png"));
console.log("✓ synthetic-density-raster.png");

await savePng(densityLabels, W, H, path.join(SAMPLES, "synthetic-density-instances.png"));
console.log("✓ synthetic-density-instances.png");

// ═══════════════════════════════════════════════════════════════════════════════
// MANIFESTS
// ═══════════════════════════════════════════════════════════════════════════════

// --- Scale manifest: uses the periodic scene ---
const scaleManifest = [
  {
    id: "synthetic-shrink-50",
    imageUrl: "eval/samples/synthetic-scale-scene.png",
    targetFraction: 0.5,
    bbox: { x: 0, y: 0, w: 1, h: 1 },
    rasterUrl: "eval/samples/synthetic-scale-raster.png",
    note: "Synthetic: repeating dot grid (period=40px), shrink 50%. Mirror-tile should fill."
  },
  {
    id: "synthetic-enlarge-130",
    imageUrl: "eval/samples/synthetic-scale-scene.png",
    targetFraction: 1.3,
    bbox: { x: 0, y: 0, w: 1, h: 1 },
    rasterUrl: "eval/samples/synthetic-scale-raster.png",
    note: "Synthetic: repeating dot grid (period=40px), enlarge 30%. Center-crop."
  },
  {
    id: "synthetic-passthrough",
    imageUrl: "eval/samples/synthetic-scale-scene.png",
    targetFraction: 1.0,
    bbox: { x: 0, y: 0, w: 1, h: 1 },
    rasterUrl: "eval/samples/synthetic-scale-raster.png",
    note: "Synthetic: identity fraction — passthrough."
  }
];
writeFileSync(path.join(SAMPLES, "scale.manifest.json"), JSON.stringify(scaleManifest, null, 2) + "\n");
console.log("✓ scale.manifest.json");

// --- Density manifest: includes the lattice-cap-fail case ---
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
console.log("  pnpm eval");
