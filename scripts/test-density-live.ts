/**
 * Live density test: calls generateDensityImage directly with a known
 * image to verify the full SAM2 → densityThin → PNG pipeline.
 *
 * Run: cd /home/ubuntu/astersports-landing && npx tsx scripts/test-density-live.ts
 */
import "dotenv/config";
import { generateDensityImage } from "../server/aiEngine";
import { storageGetSignedUrl } from "../server/storage";
import sharp from "sharp";
import fs from "fs";
import path from "path";

const TEST_IMAGE_STORAGE_KEY = "studio/1/1781950779568-IMG_0234_0d54f07d.jpg";
const TEST_PERCENT = 30;
const OUTPUT_DIR = "/home/ubuntu/astersports-landing/scripts/density-test-output";

async function main() {
  console.log("╔══════════════════════════════════════════╗");
  console.log("║     DENSITY LIVE E2E TEST                ║");
  console.log("╚══════════════════════════════════════════╝");
  console.log("");

  // Ensure output directory exists
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // Get a signed URL for the test image
  console.log(`[1/4] Resolving image URL...`);
  const signedUrl = await storageGetSignedUrl(TEST_IMAGE_STORAGE_KEY);
  console.log(`  ✓ Signed URL obtained (${signedUrl.substring(0, 60)}...)`);

  // Call generateDensityImage
  console.log(`\n[2/4] Calling generateDensityImage(percent=${TEST_PERCENT})...`);
  console.log(`  → This calls SAM2 via Replicate for segmentation`);
  console.log(`  → Then runs densityThin locally for motif removal`);
  console.log(`  (This may take 15-45 seconds for SAM2 cold start...)\n`);

  const startTime = Date.now();
  const audit = { orgId: "test-e2e", jobId: "density-live-test" };

  try {
    const result = await generateDensityImage(
      `/manus-storage/${TEST_IMAGE_STORAGE_KEY}`,
      TEST_PERCENT,
      audit
    );

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    if (!result) {
      console.log(`\n[RESULT] ❌ generateDensityImage returned null (${elapsed}s)`);
      console.log(`  This means either:`);
      console.log(`  - SAM2 returned no/empty raster or 0 instances (provider degrade)`);
      console.log(`  - densityThin removed 0 motifs (no-op guard)`);
      console.log(`  → In production this triggers a full refund.`);
      process.exit(1);
    }

    console.log(`[3/4] ✓ Density processing complete (${elapsed}s)`);
    console.log(`  → Removed: ${result.removed} motifs`);
    console.log(`  → PNG size: ${(result.png.length / 1024).toFixed(0)} KB`);

    // Save the output PNG
    const outputPath = path.join(OUTPUT_DIR, `density-${TEST_PERCENT}pct-result.png`);
    fs.writeFileSync(outputPath, result.png);
    console.log(`  → Saved to: ${outputPath}`);

    // Get dimensions
    const metadata = await sharp(result.png).metadata();
    console.log(`  → Dimensions: ${metadata.width}x${metadata.height}`);

    // Also save the original for comparison
    console.log(`\n[4/4] Saving original for comparison...`);
    const { default: fetch } = await import("node-fetch");
    const origResp = await globalThis.fetch(signedUrl);
    const origBuffer = Buffer.from(await origResp.arrayBuffer());
    const origPath = path.join(OUTPUT_DIR, `original.jpg`);
    fs.writeFileSync(origPath, origBuffer);
    console.log(`  → Original saved to: ${origPath}`);

    console.log(`\n╔══════════════════════════════════════════╗`);
    console.log(`║  ✅ DENSITY TEST PASSED                  ║`);
    console.log(`╠══════════════════════════════════════════╣`);
    console.log(`║  Percent requested: ${TEST_PERCENT}%`);
    console.log(`║  Motifs removed:    ${result.removed}`);
    console.log(`║  Time:              ${elapsed}s`);
    console.log(`║  Output:            ${outputPath}`);
    console.log(`╚══════════════════════════════════════════╝`);

  } catch (err: any) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.error(`\n[RESULT] ❌ FAILED after ${elapsed}s`);
    console.error(`  Error: ${err.message}`);
    if (err.stack) {
      console.error(`\n  Stack trace:`);
      console.error(err.stack.split("\n").slice(1, 6).join("\n"));
    }
    process.exit(1);
  }
}

main();
