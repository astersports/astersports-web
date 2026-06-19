// S5 — SEGMENTATION QUALITY (PRIMARY GATE).
// Usage: node scripts/spike/s5_segmentation.mjs <img1> <img2> ...
//
// Arm A (classical, real today): vision-LLM fabric bbox -> sharp crop saved for
//   eyeballing. NOTE: a full classical RASTER mask needs GrabCut = OpenCV (NOT
//   sharp); that prototype requires an extra native/wasm dep (see README flag 1).
// Arm B (SAM2): runs only if SAM2_API_URL/SAM2_API_KEY are set. Adapt the
//   request/response shape to the chosen host.
import { requireEnv, chat, ensureOut, OUT_DIR } from "./_forge.mjs";
import sharp from "sharp";
import { readFile } from "node:fs/promises";
import path from "node:path";

requireEnv();
await ensureOut();
const images = process.argv.slice(2);
if (images.length === 0) { console.error("Usage: node scripts/spike/s5_segmentation.mjs <img...>"); process.exit(1); }

const SYSTEM =
  "You are a textile-print vision analyst. Return the axis-aligned bounding box of the " +
  "flattest, most frontal region of PRINTED FABRIC (avoid seams, edges, shadow, hanger, " +
  "background). Coordinates normalized 0..1. Give an honest confidence.";
const SCHEMA = {
  type: "json_schema",
  json_schema: {
    name: "fabric_region", strict: true,
    schema: {
      type: "object",
      properties: { x:{type:"number"}, y:{type:"number"}, w:{type:"number"}, h:{type:"number"}, confidence:{type:"number"} },
      required: ["x","y","w","h","confidence"], additionalProperties: false,
    },
  },
};

const SAM2_URL = process.env.SAM2_API_URL;
const SAM2_KEY = process.env.SAM2_API_KEY;

for (const imgPath of images) {
  const name = path.basename(imgPath).replace(/\.[^.]+$/, "");
  console.log(`\n=== ${imgPath} ===`);
  const bytes = await readFile(imgPath);
  const b64 = bytes.toString("base64");

  // Arm A: bbox via vision LLM, then crop with sharp for visual review.
  const r = await chat({
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: [
        { type: "text", text: "Return the best printed-fabric region bbox." },
        { type: "image_url", image_url: { url: `data:image/jpeg;base64,${b64}`, detail: "low" } },
      ]},
    ],
    response_format: SCHEMA,
  });
  if (!r.ok) { console.error("  [A] vision call failed:", r.status, r.text.slice(0,200)); continue; }
  let box;
  try { box = JSON.parse(r.json.choices[0].message.content); } catch { console.error("  [A] unparseable bbox"); continue; }
  console.log("  [A classical bbox]", JSON.stringify(box));

  const meta = await sharp(bytes).rotate().metadata();
  const W = meta.width, H = meta.height;
  const left = Math.max(0, Math.round((box.x||0)*W));
  const top = Math.max(0, Math.round((box.y||0)*H));
  const width = Math.max(1, Math.min(Math.round((box.w||0.1)*W), W-left));
  const height = Math.max(1, Math.min(Math.round((box.h||0.1)*H), H-top));
  const cropOut = path.join(OUT_DIR, `s5_${name}_bboxcrop.png`);
  await sharp(bytes).rotate().extract({ left, top, width, height }).png().toFile(cropOut);
  console.log("  [A] crop saved:", cropOut, "(does it contain clean print, excluding bg/hanger/skin?)");

  // Arm B: SAM2 (only if configured). Shape is host-specific — adapt as needed.
  if (SAM2_URL && SAM2_KEY) {
    try {
      const res = await fetch(SAM2_URL, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${SAM2_KEY}` },
        // Box-prompt SAM2 with the bbox above; many hosts also support automatic masks.
        body: JSON.stringify({ image: `data:image/jpeg;base64,${b64}`, box: [left, top, left+width, top+height] }),
      });
      console.log("  [B SAM2] status:", res.status, "(save/inspect the returned mask; can instances be separated?)");
      // TODO: decode host's mask response and save to scripts/spike/out/s5_<name>_sam2.png
    } catch (e) {
      console.error("  [B SAM2] error:", e.message);
    }
  } else {
    console.log("  [B SAM2] skipped (set SAM2_API_URL / SAM2_API_KEY to run).");
  }
}

console.log(
  "\nSCORE each garment per arm: pass / marginal / fail on (1) fabric mask includes print & excludes" +
  " bg/hanger/skin, (2) per-motif instances separable (needed for density)." +
  "\nOUTPUT: classical-vs-SAM2 table + TIER RECOMMENDATION (floor vs SAM2). This sets D1."
);
