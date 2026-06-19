// S1 — Does GenerateImage actually USE a second reference image?
// Usage: node scripts/spike/s1_reference_image.mjs <garment.jpg> <reference.png>
// PASS only if the SCALE/pattern of the reference visibly transfers (Test B).
import { requireEnv, fileToImage, generateImage, saveResultImage } from "./_forge.mjs";

requireEnv();
const [garmentPath, refPath] = process.argv.slice(2);
if (!garmentPath || !refPath) {
  console.error("Usage: node scripts/spike/s1_reference_image.mjs <garment> <reference>");
  process.exit(1);
}

const garment = await fileToImage(garmentPath);
const reference = await fileToImage(refPath);

const prompt =
  "Image 1 is a garment photo. Image 2 is the TARGET fabric print. " +
  "Re-print the fabric in image 1 so its print matches the motif scale and look of image 2. " +
  "Keep image 1's garment shape, pose, drape, lighting and background identical.";

console.log("S1: sending [garment, reference] ...");
const r = await generateImage({ prompt, originalImages: [garment, reference] });
console.log("status:", r.status, "ok:", r.ok);
if (!r.ok) { console.error("body:", r.text.slice(0, 500)); process.exit(2); }

const saved = await saveResultImage(r.json, "s1_result.png");
console.log("saved:", saved);
console.log(
  "\nVERDICT (manual): open the result and the inputs.\n" +
  " - Test A: with a solid-color reference, does the fabric change toward it at all?\n" +
  " - Test B (decisive): with a real scaled swatch of the SAME motif, does the motif SCALE transfer\n" +
  "   while the garment pose holds? PASS the spike only if Test B transfers scale."
);
