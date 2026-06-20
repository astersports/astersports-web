/**
 * Create a diff visualization showing exactly which pixels were changed by density.
 * Changed pixels shown in bright magenta, unchanged in grayscale.
 * Run: cd /home/ubuntu/astersports-landing && npx tsx scripts/test-density-diff.ts
 */
import "dotenv/config";
import { storageGetSignedUrl } from "../server/storage";
import sharp from "sharp";
import fs from "fs";
import path from "path";

const OUTPUT_DIR = "/home/ubuntu/astersports-landing/scripts/density-test-output";
const TEST_IMAGE_STORAGE_KEY = "studio/1/1781950779568-IMG_0234_0d54f07d.jpg";

async function main() {
  // Load original at full res
  const signedUrl = await storageGetSignedUrl(TEST_IMAGE_STORAGE_KEY);
  const resp = await fetch(signedUrl);
  const origBuffer = Buffer.from(await resp.arrayBuffer());
  
  const origRaw = await sharp(origBuffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const resultRaw = await sharp(path.join(OUTPUT_DIR, "density-60pct-result.png")).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  
  const w = origRaw.info.width;
  const h = origRaw.info.height;
  console.log(`Comparing ${w}x${h} images...`);
  
  const diff = Buffer.alloc(w * h * 4);
  let changedPixels = 0;
  const threshold = 5; // RGB difference threshold to count as "changed"
  
  for (let i = 0; i < w * h; i++) {
    const p = i * 4;
    const dr = Math.abs(origRaw.data[p] - resultRaw.data[p]);
    const dg = Math.abs(origRaw.data[p + 1] - resultRaw.data[p + 1]);
    const db = Math.abs(origRaw.data[p + 2] - resultRaw.data[p + 2]);
    const totalDiff = dr + dg + db;
    
    if (totalDiff > threshold) {
      // Changed pixel - show in bright magenta with intensity based on diff
      const intensity = Math.min(255, totalDiff * 2);
      diff[p] = intensity;       // R
      diff[p + 1] = 0;           // G
      diff[p + 2] = intensity;   // B
      diff[p + 3] = 255;
      changedPixels++;
    } else {
      // Unchanged - show in dim grayscale
      const gray = Math.round((origRaw.data[p] + origRaw.data[p + 1] + origRaw.data[p + 2]) / 3);
      diff[p] = Math.round(gray * 0.3);
      diff[p + 1] = Math.round(gray * 0.3);
      diff[p + 2] = Math.round(gray * 0.3);
      diff[p + 3] = 255;
    }
  }
  
  const totalPixels = w * h;
  console.log(`Changed pixels: ${changedPixels} / ${totalPixels} (${(changedPixels / totalPixels * 100).toFixed(2)}%)`);
  
  const diffPath = path.join(OUTPUT_DIR, "diff-60pct.png");
  await sharp(diff, { raw: { width: w, height: h, channels: 4 } }).png().toFile(diffPath);
  console.log(`Diff saved: ${diffPath}`);
}

main().catch(e => { console.error(e.message); process.exit(1); });
