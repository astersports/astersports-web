/**
 * Live density test at 60% to verify more dramatic removal.
 * Run: cd /home/ubuntu/astersports-landing && npx tsx scripts/test-density-60pct.ts
 */
import "dotenv/config";
import { generateDensityImage } from "../server/aiEngine";
import sharp from "sharp";
import fs from "fs";
import path from "path";

const TEST_IMAGE_STORAGE_KEY = "studio/1/1781950779568-IMG_0234_0d54f07d.jpg";
const TEST_PERCENT = 60;
const OUTPUT_DIR = "/home/ubuntu/astersports-landing/scripts/density-test-output";

async function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  console.log(`=== DENSITY TEST @ ${TEST_PERCENT}% ===\n`);

  const startTime = Date.now();
  const result = await generateDensityImage(
    `/manus-storage/${TEST_IMAGE_STORAGE_KEY}`,
    TEST_PERCENT,
    { orgId: "test-e2e", jobId: "density-60pct-test" }
  );

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  if (!result) {
    console.log(`❌ Returned null after ${elapsed}s`);
    process.exit(1);
  }

  console.log(`✅ Complete in ${elapsed}s — removed ${result.removed} motifs`);
  const outputPath = path.join(OUTPUT_DIR, `density-${TEST_PERCENT}pct-result.png`);
  fs.writeFileSync(outputPath, result.png);
  console.log(`Saved: ${outputPath} (${(result.png.length / 1024).toFixed(0)} KB)`);
}

main().catch((e) => { console.error("FATAL:", e.message); process.exit(1); });
