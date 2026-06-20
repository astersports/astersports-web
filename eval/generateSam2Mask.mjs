/**
 * Generate a SAM2 truth mask for the black floral skirt using Replicate API.
 * 
 * meta/sam-2 on Replicate uses automatic mask generation (points_per_side grid).
 * It returns: combined_mask (all segments) + individual_masks (per-segment).
 * We'll use the automatic segmentation and then select the largest mask that
 * corresponds to the skirt fabric area.
 */
import { readFile, writeFile } from "node:fs/promises";
import sharp from "sharp";

const IMAGE_PATH = "eval/samples/black-floral-skirt.jpg";
const OUTPUT_PATH = "eval/samples/black-floral-skirt.mask.png";
const REPLICATE_TOKEN = process.env.REPLICATE_API_TOKEN;
const VERSION = "fe97b453a6455861e3bac769b441ca1f1086110da7466dbb65cf1eecfd60dc83";

async function main() {
  const imgBuffer = await readFile(IMAGE_PATH);
  const metadata = await sharp(imgBuffer).metadata();
  const { width, height } = metadata;
  console.log(`Image dimensions: ${width}x${height}`);

  // Convert to base64 data URI
  const base64 = imgBuffer.toString("base64");
  const dataUri = `data:image/jpeg;base64,${base64}`;

  // Create prediction
  console.log("Creating SAM2 prediction...");
  const createResp = await fetch("https://api.replicate.com/v1/predictions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${REPLICATE_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      version: VERSION,
      input: {
        image: dataUri,
        use_m2m: true,
        points_per_side: 32,
        pred_iou_thresh: 0.88,
        stability_score_thresh: 0.95,
      },
    }),
  });

  if (!createResp.ok) {
    const err = await createResp.text();
    throw new Error(`Failed to create prediction: ${createResp.status} ${err}`);
  }

  let prediction = await createResp.json();
  console.log(`Prediction ID: ${prediction.id}, status: ${prediction.status}`);

  // Poll until complete
  while (prediction.status !== "succeeded" && prediction.status !== "failed") {
    await new Promise(r => setTimeout(r, 2000));
    const pollResp = await fetch(`https://api.replicate.com/v1/predictions/${prediction.id}`, {
      headers: { "Authorization": `Bearer ${REPLICATE_TOKEN}` },
    });
    prediction = await pollResp.json();
    console.log(`  Status: ${prediction.status}`);
  }

  if (prediction.status === "failed") {
    throw new Error(`Prediction failed: ${prediction.error}`);
  }

  const output = prediction.output;
  console.log(`Output keys: ${Object.keys(output)}`);

  // Download individual masks and find the one covering the skirt area
  const individualMasks = output.individual_masks || [];
  const combinedMaskUrl = output.combined_mask;
  
  console.log(`Got ${individualMasks.length} individual masks + combined mask`);

  // Strategy: Download all individual masks, find the one with the most white pixels
  // in the skirt bbox area (center of image, roughly 27-73% x, 16-94% y)
  const bboxX1 = Math.round(0.27 * width);
  const bboxY1 = Math.round(0.16 * height);
  const bboxX2 = Math.round(0.73 * width);
  const bboxY2 = Math.round(0.94 * height);

  let bestMask = null;
  let bestScore = 0;

  for (let i = 0; i < individualMasks.length; i++) {
    const url = individualMasks[i];
    const resp = await fetch(url);
    if (!resp.ok) continue;
    const buf = Buffer.from(await resp.arrayBuffer());
    
    // Get raw grayscale pixels
    const { data } = await sharp(buf)
      .resize(width, height, { fit: "fill" })
      .grayscale()
      .raw()
      .toBuffer({ resolveWithObject: true })
      .then(r => r);
    
    const rawData = (await sharp(buf).resize(width, height, { fit: "fill" }).grayscale().raw().toBuffer());

    // Count white pixels in the skirt bbox
    let bboxWhite = 0;
    let totalWhite = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const px = rawData[y * width + x];
        if (px > 127) {
          totalWhite++;
          if (x >= bboxX1 && x <= bboxX2 && y >= bboxY1 && y <= bboxY2) {
            bboxWhite++;
          }
        }
      }
    }

    // Score: prefer masks that are large and concentrated in the skirt area
    const bboxArea = (bboxX2 - bboxX1) * (bboxY2 - bboxY1);
    const coverage = bboxWhite / bboxArea; // how much of bbox is covered
    const precision = totalWhite > 0 ? bboxWhite / totalWhite : 0; // how much of mask is in bbox
    const score = coverage * precision;

    console.log(`  Mask ${i}: totalWhite=${totalWhite}, bboxWhite=${bboxWhite}, coverage=${coverage.toFixed(3)}, precision=${precision.toFixed(3)}, score=${score.toFixed(4)}`);

    if (score > bestScore) {
      bestScore = score;
      bestMask = buf;
    }
  }

  if (!bestMask) {
    // Fallback: use the combined mask
    console.log("No individual mask found, using combined mask...");
    const resp = await fetch(combinedMaskUrl);
    bestMask = Buffer.from(await resp.arrayBuffer());
  }

  // Process the best mask: resize to exact dimensions, threshold to binary
  const finalMask = await sharp(bestMask)
    .resize(width, height, { fit: "fill" })
    .grayscale()
    .threshold(127)
    .png()
    .toBuffer();

  await writeFile(OUTPUT_PATH, finalMask);
  console.log(`\nTruth mask saved: ${OUTPUT_PATH} (score: ${bestScore.toFixed(4)})`);

  // Verify
  const maskMeta = await sharp(finalMask).metadata();
  console.log(`Mask dimensions: ${maskMeta.width}x${maskMeta.height}`);
}

main().catch((e) => {
  console.error("Error:", e.message || e);
  process.exit(1);
});
