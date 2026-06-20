/**
 * Real-garment confirmation script for the Density Live path (D-C).
 *
 * Calls the full pipeline: locateFabricRegion (vision LLM) → SAM2 crop → autoMasks
 * → densityThin → PNG output. Reports instance count, removed count, and writes
 * before/after PNGs for visual inspection.
 *
 * Usage: STUDIO_MASK_PROVIDER=sam2 STUDIO_DENSITY_LIVE=true npx tsx scripts/confirmDensityLive.mjs
 *
 * Requires: REPLICATE_API_TOKEN, REPLICATE_SAM2_MODEL in env.
 */
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");

// Force env for this script
process.env.STUDIO_MASK_PROVIDER = "sam2";
process.env.STUDIO_DENSITY_LIVE = "true";
if (!process.env.REPLICATE_SAM2_MODEL) {
  process.env.REPLICATE_SAM2_MODEL = "fe97b453a6455861e3bac769b441ca1f1086110da7466dbb65cf1eecfd60dc83";
}

// Dynamic imports (after env is set)
const { getMaskProvider } = await import("../server/_core/masking/index.ts");
const { densityThin } = await import("../server/_core/studio/ops/densityThin.ts");
const { setSam2AuditContext, clearSam2AuditContext } = await import("../server/_core/masking/sam2Provider.ts");
const sharp = (await import("sharp")).default;

const SKIRT_PATH = resolve(projectRoot, "eval/samples/black-floral-skirt.jpg");
const OUT_DIR = resolve(projectRoot, "eval/out/density-live-confirm");
mkdirSync(OUT_DIR, { recursive: true });

const PERCENT = Number(process.argv[2]) || 20;

// Use CDN URL so the vision LLM and Replicate can access it without base64 bloat
const IMAGE_URL = process.argv[3] || "https://files.manuscdn.com/user_upload_by_module/session_file/310519663756289268/UQGAjoXMlGbbFpHX.jpg";

console.log("=== Density Live Confirmation ===");
console.log(`Image: ${IMAGE_URL}`);
console.log(`Density percent: ${PERCENT}%`);
console.log(`Provider: sam2`);
console.log(`SAM2 model: ${process.env.REPLICATE_SAM2_MODEL?.slice(0, 12)}...`);
console.log("");

const imgBuffer = readFileSync(SKIRT_PATH);

// Set audit context
setSam2AuditContext({ orgId: "confirmation-test", jobId: "density-live-confirm" });

const provider = getMaskProvider();
console.log(`[1/4] Provider: ${provider.name}, rasterReady: ${provider.rasterReady}`);

// Step 1: Get fabric mask
console.log("[2/4] Getting fabric mask (vision LLM bbox → SAM2 box-prompt)...");
const t0 = Date.now();
const fabric = await provider.getFabricMask({ url: IMAGE_URL });
const t1 = Date.now();
console.log(`  ✓ Fabric mask obtained in ${((t1 - t0) / 1000).toFixed(1)}s`);
console.log(`  bbox: x=${fabric.bbox.x.toFixed(3)} y=${fabric.bbox.y.toFixed(3)} w=${fabric.bbox.w.toFixed(3)} h=${fabric.bbox.h.toFixed(3)}`);
console.log(`  confidence: ${fabric.confidence.toFixed(3)}`);
console.log(`  raster: ${fabric.raster ? `${fabric.raster.width}x${fabric.raster.height}` : "NONE (FAIL)"}`);

if (!fabric.raster) {
  console.error("❌ FAIL: No raster from SAM2 provider. Cannot proceed.");
  process.exit(1);
}

// Step 2: Get instance masks
console.log("[3/4] Getting instance masks (SAM2 autoMasks on cropped region)...");
const t2 = Date.now();
const instances = await provider.getInstanceMasks({ url: IMAGE_URL }, fabric);
const t3 = Date.now();
console.log(`  ✓ Instance masks obtained in ${((t3 - t2) / 1000).toFixed(1)}s`);
console.log(`  Instance count: ${instances.length}`);

if (instances.length === 0) {
  console.error("❌ FAIL: SAM2 returned 0 instances. Provider degraded.");
  process.exit(1);
}

// Log instance sizes
const instanceAreas = instances.map((inst, i) => {
  const area = inst.raster ? inst.raster.data.reduce((sum, v) => sum + (v > 127 ? 1 : 0), 0) : 0;
  return { i, area, bbox: inst.bbox };
});
console.log(`  Instance areas (top 5): ${instanceAreas.slice(0, 5).map(a => `#${a.i}=${a.area}px`).join(", ")}`);
console.log(`  Smallest instance: ${instanceAreas[instanceAreas.length - 1]?.area}px`);

// Step 3: Run densityThin
console.log(`[4/4] Running densityThin at ${PERCENT}%...`);
const t4 = Date.now();
const result = await densityThin({
  image: { url: IMAGE_URL },
  fabric,
  instances,
  percent: PERCENT,
});
const t5 = Date.now();
console.log(`  ✓ densityThin completed in ${((t5 - t4) / 1000).toFixed(1)}s`);
console.log(`  Removed: ${result.removed} of ${instances.length} instances`);
console.log(`  Expected removal: ~${Math.round(instances.length * PERCENT / 100)} (${PERCENT}% of ${instances.length})`);
console.log(`  Output: ${result.width}x${result.height} RGBA`);

// Write output PNG
const outPng = await sharp(Buffer.from(result.data.buffer), {
  raw: { width: result.width, height: result.height, channels: 4 },
}).png().toBuffer();

const outPath = resolve(OUT_DIR, `density-${PERCENT}-after.png`);
writeFileSync(outPath, outPng);
console.log(`  Written: ${outPath}`);

// Also copy the original for side-by-side
const origOutPath = resolve(OUT_DIR, `density-${PERCENT}-before.jpg`);
writeFileSync(origOutPath, imgBuffer);
console.log(`  Original: ${origOutPath}`);

clearSam2AuditContext();

// Summary
console.log("\n=== SUMMARY ===");
const expectedRemoval = Math.round(instances.length * PERCENT / 100);
const actualRemoval = result.removed;
const countError = Math.abs(actualRemoval - expectedRemoval) / instances.length;
console.log(`  Instances detected: ${instances.length}`);
console.log(`  Expected removal (${PERCENT}%): ${expectedRemoval}`);
console.log(`  Actual removal: ${actualRemoval}`);
console.log(`  Count error: ${(countError * 100).toFixed(1)}%`);
console.log(`  Total time: ${((t5 - t0) / 1000).toFixed(1)}s`);

if (instances.length >= 10 && countError <= 0.10) {
  console.log("  ✅ PASS: Instance segmentation looks correct, count error within 10%");
} else if (instances.length < 5) {
  console.log("  ⚠️  WARNING: Only ${instances.length} instances detected — SAM2 may be treating clusters as single blobs");
} else {
  console.log(`  ⚠️  WARNING: Count error ${(countError * 100).toFixed(1)}% exceeds 10% threshold`);
}
