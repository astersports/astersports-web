/**
 * Diagnostic: inspect what SAM2 returns for the test image.
 * Checks fabric raster coverage, instance count, and bare-ground availability.
 *
 * Run: cd /home/ubuntu/astersports-landing && npx tsx scripts/test-density-diag.ts
 */
import "dotenv/config";
import { getMaskProvider } from "../server/_core/masking";
import { storageGetSignedUrl } from "../server/storage";
import { decodeUpright } from "../server/_core/image/decodeUpright";
import sharp from "sharp";
import fs from "fs";
import path from "path";

const TEST_IMAGE_STORAGE_KEY = "studio/1/1781950779568-IMG_0234_0d54f07d.jpg";
const OUTPUT_DIR = "/home/ubuntu/astersports-landing/scripts/density-test-output";

async function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  console.log("=== DENSITY DIAGNOSTIC ===\n");

  // 1. Get signed URL
  const signedUrl = await storageGetSignedUrl(TEST_IMAGE_STORAGE_KEY);
  console.log(`Image URL: ${signedUrl.substring(0, 60)}...`);

  // 2. Decode image to get dimensions
  const { buffer, width, height } = await decodeUpright(signedUrl);
  console.log(`Image dimensions: ${width}x${height} (${(width * height / 1e6).toFixed(2)} MP)`);

  // 3. Call getSegmentation (single SAM2 call)
  console.log(`\nCalling SAM2 getSegmentation...`);
  const provider = getMaskProvider();
  console.log(`Provider: ${provider.name}, rasterReady: ${provider.rasterReady}`);

  const startTime = Date.now();
  const { fabric, instances } = await provider.getSegmentation!({
    url: signedUrl,
    audit: { orgId: "diag", jobId: "diag-test" },
  });
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`SAM2 call completed in ${elapsed}s`);

  // 4. Analyze fabric raster
  console.log(`\n--- FABRIC RASTER ---`);
  console.log(`  bbox: x=${fabric.bbox.x.toFixed(3)} y=${fabric.bbox.y.toFixed(3)} w=${fabric.bbox.w.toFixed(3)} h=${fabric.bbox.h.toFixed(3)}`);
  console.log(`  confidence: ${fabric.confidence}`);
  if (fabric.raster) {
    const raster = fabric.raster;
    console.log(`  raster dims: ${raster.width}x${raster.height}`);
    let onCount = 0;
    for (let i = 0; i < raster.data.length; i++) {
      if (raster.data[i] > 127) onCount++;
    }
    const totalPx = raster.width * raster.height;
    console.log(`  raster coverage: ${onCount}/${totalPx} (${(onCount / totalPx * 100).toFixed(1)}%)`);
  } else {
    console.log(`  ❌ NO RASTER (this would cause immediate null return)`);
  }

  // 5. Analyze instances
  console.log(`\n--- INSTANCES ---`);
  console.log(`  count: ${instances.length}`);
  if (instances.length > 0) {
    // Show first 5 instances
    instances.slice(0, 5).forEach((inst, i) => {
      const hasRaster = !!inst.raster;
      let rasterPx = 0;
      if (inst.raster) {
        for (let j = 0; j < inst.raster.data.length; j++) {
          if (inst.raster.data[j] > 127) rasterPx++;
        }
      }
      console.log(`  [${i}] bbox: x=${inst.bbox.x.toFixed(3)} y=${inst.bbox.y.toFixed(3)} w=${inst.bbox.w.toFixed(3)} h=${inst.bbox.h.toFixed(3)} | raster: ${hasRaster} (${rasterPx}px)`);
    });
    if (instances.length > 5) console.log(`  ... and ${instances.length - 5} more`);
  }

  // 6. Simulate the bare-ground check (same as densityThin)
  console.log(`\n--- BARE-GROUND CHECK ---`);
  if (fabric.raster && instances.length > 0) {
    const raster = fabric.raster;
    const w = raster.width, h = raster.height;

    // Mark all instance pixels
    const inAny = new Uint8Array(w * h);
    for (const inst of instances) {
      if (inst.raster && inst.raster.width === w && inst.raster.height === h) {
        for (let i = 0; i < w * h; i++) {
          if (inst.raster.data[i] > 127) inAny[i] = 1;
        }
      } else {
        // bbox fallback
        const x0 = Math.max(0, Math.floor(inst.bbox.x * w));
        const y0 = Math.max(0, Math.floor(inst.bbox.y * h));
        const x1 = Math.min(w, Math.ceil((inst.bbox.x + inst.bbox.w) * w));
        const y1 = Math.min(h, Math.ceil((inst.bbox.y + inst.bbox.h) * h));
        for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) inAny[y * w + x] = 1;
      }
    }

    let instancePixels = 0;
    for (let i = 0; i < w * h; i++) if (inAny[i]) instancePixels++;

    let fabricPixels = 0;
    for (let i = 0; i < w * h; i++) if (raster.data[i] > 127) fabricPixels++;

    let bareGround = 0;
    for (let i = 0; i < w * h; i++) {
      if (raster.data[i] > 127 && !inAny[i]) bareGround++;
    }

    const totalPx = w * h;
    console.log(`  Total pixels:    ${totalPx}`);
    console.log(`  Fabric pixels:   ${fabricPixels} (${(fabricPixels / totalPx * 100).toFixed(1)}%)`);
    console.log(`  Instance pixels: ${instancePixels} (${(instancePixels / totalPx * 100).toFixed(1)}%)`);
    console.log(`  Bare ground:     ${bareGround} (${(bareGround / totalPx * 100).toFixed(1)}%)`);

    if (bareGround === 0) {
      console.log(`\n  ❌ PROBLEM: Zero bare-ground pixels!`);
      console.log(`  The combined_mask (fabric) is entirely covered by instance masks.`);
      console.log(`  densityThin cannot sample the base cloth color → returns null → refund.`);
      console.log(`\n  POSSIBLE CAUSES:`);
      console.log(`  1. SAM2 combined_mask is too tight (only covers motifs, not ground)`);
      console.log(`  2. Instance masks overlap/cover the entire fabric region`);
      console.log(`  3. The fabric bbox is too small (only the dense motif area)`);
    } else {
      console.log(`\n  ✓ Bare ground available — densityThin should work.`);
    }

    // Save a visualization of the fabric raster and instance coverage
    const vizBuffer = Buffer.alloc(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      const p = i * 4;
      if (raster.data[i] > 127 && !inAny[i]) {
        // Bare ground = green
        vizBuffer[p] = 0; vizBuffer[p + 1] = 255; vizBuffer[p + 2] = 0; vizBuffer[p + 3] = 255;
      } else if (raster.data[i] > 127 && inAny[i]) {
        // Fabric + instance = red
        vizBuffer[p] = 255; vizBuffer[p + 1] = 0; vizBuffer[p + 2] = 0; vizBuffer[p + 3] = 255;
      } else if (inAny[i]) {
        // Instance outside fabric = yellow
        vizBuffer[p] = 255; vizBuffer[p + 1] = 255; vizBuffer[p + 2] = 0; vizBuffer[p + 3] = 255;
      } else {
        // Neither = dark
        vizBuffer[p] = 30; vizBuffer[p + 1] = 30; vizBuffer[p + 2] = 30; vizBuffer[p + 3] = 255;
      }
    }
    const vizPath = path.join(OUTPUT_DIR, "diag-coverage.png");
    await sharp(vizBuffer, { raw: { width: w, height: h, channels: 4 } }).png().toFile(vizPath);
    console.log(`\n  Visualization saved: ${vizPath}`);
    console.log(`  GREEN = bare ground, RED = fabric+instance, YELLOW = instance outside fabric, DARK = neither`);
  }
}

main().catch((e) => {
  console.error("FATAL:", e.message);
  console.error(e.stack?.split("\n").slice(1, 5).join("\n"));
  process.exit(1);
});
