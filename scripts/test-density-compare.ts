/**
 * Create a side-by-side comparison image showing original vs density-reduced.
 * Run: cd /home/ubuntu/astersports-landing && npx tsx scripts/test-density-compare.ts
 */
import "dotenv/config";
import { storageGetSignedUrl } from "../server/storage";
import sharp from "sharp";
import fs from "fs";
import path from "path";

const OUTPUT_DIR = "/home/ubuntu/astersports-landing/scripts/density-test-output";
const TEST_IMAGE_STORAGE_KEY = "studio/1/1781950779568-IMG_0234_0d54f07d.jpg";

async function main() {
  // Get original image
  const signedUrl = await storageGetSignedUrl(TEST_IMAGE_STORAGE_KEY);
  const resp = await fetch(signedUrl);
  const origBuffer = Buffer.from(await resp.arrayBuffer());
  
  // Resize both to 768 wide for comparison
  const targetW = 768;
  const original = await sharp(origBuffer).resize(targetW).png().toBuffer();
  const result30 = await sharp(path.join(OUTPUT_DIR, "density-30pct-result.png")).resize(targetW).png().toBuffer();
  const result60 = await sharp(path.join(OUTPUT_DIR, "density-60pct-result.png")).resize(targetW).png().toBuffer();
  
  const origMeta = await sharp(original).metadata();
  const h = origMeta.height!;
  
  // Create side-by-side: original | 30% | 60%
  const comparison = await sharp({
    create: { width: targetW * 3, height: h, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } }
  })
    .composite([
      { input: original, left: 0, top: 0 },
      { input: result30, left: targetW, top: 0 },
      { input: result60, left: targetW * 2, top: 0 },
    ])
    .png()
    .toBuffer();
  
  const comparePath = path.join(OUTPUT_DIR, "comparison-orig-30-60.png");
  fs.writeFileSync(comparePath, comparison);
  console.log(`Comparison saved: ${comparePath}`);
  console.log(`Dimensions: ${targetW * 3}x${h}`);
  
  // Also save the original
  const origPath = path.join(OUTPUT_DIR, "original.png");
  fs.writeFileSync(origPath, await sharp(origBuffer).png().toBuffer());
  console.log(`Original saved: ${origPath}`);
}

main().catch(e => { console.error(e.message); process.exit(1); });
