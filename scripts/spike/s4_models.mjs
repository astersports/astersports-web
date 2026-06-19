// S4 — Forge image model identity (answers D2) + optional finish-quality probe.
// Usage:
//   node scripts/spike/s4_models.mjs
//   node scripts/spike/s4_models.mjs <garment.jpg> "pink blossoms" "coral"   # optional recolor probe
import { requireEnv, generateImage, saveResultImage, fileToImage } from "./_forge.mjs";

requireEnv();
const FORGE = (process.env.BUILT_IN_FORGE_API_URL || "").replace(/\/+$/, "");
const KEY = process.env.BUILT_IN_FORGE_API_KEY || "";

console.log("S4: GET /v1/models");
const res = await fetch(`${FORGE}/v1/models`, { headers: { authorization: `Bearer ${KEY}` } });
const text = await res.text();
console.log("status:", res.status);
try {
  const json = JSON.parse(text);
  const ids = (json.data || []).map((m) => m.id);
  console.log("models:", ids.join(", ") || "(none listed)");
  console.log("\nNote: the GenerateImage model may not appear in /v1/models (different service).");
  console.log("If absent, record it from Forge docs/console — this is the D2 answer.");
} catch {
  console.log("body:", text.slice(0, 500));
}

const [garmentPath, element, color] = process.argv.slice(2);
if (garmentPath && element && color) {
  console.log(`\nS4 finish probe: recolor "${element}" -> "${color}"`);
  const garment = await fileToImage(garmentPath);
  const r = await generateImage({
    prompt: `Recolor the "${element}" motifs on this fabric to ${color}, preserving shading and texture. Keep the garment and background identical.`,
    originalImages: [garment],
  });
  console.log("status:", r.status, "ok:", r.ok);
  if (r.ok) console.log("saved:", await saveResultImage(r.json, "s4_finish_probe.png"));
  console.log("Judge the finish quality by eye: clean dye-lot change vs flat overlay/artifacts.");
}
