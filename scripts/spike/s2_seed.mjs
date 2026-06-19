// S2 — seed / Connect-RPC measurement ONLY.
// Usage: node scripts/spike/s2_seed.mjs <garment.jpg>
// DECISION already made: production sends NO seed in ANY payload. This only
// measures whether Scale's OPTIONAL relight reproducibility is available.
import { requireEnv, fileToImage, generateImage } from "./_forge.mjs";
import { createHash } from "node:crypto";

requireEnv();
const [garmentPath] = process.argv.slice(2);
if (!garmentPath) { console.error("Usage: node scripts/spike/s2_seed.mjs <garment>"); process.exit(1); }
const garment = await fileToImage(garmentPath);
const prompt = "Slightly enhance the fabric print contrast. Keep everything else identical.";
const SEED = 12345;

function hashOf(json) {
  const b64 = json?.image?.b64Json || "";
  return createHash("sha256").update(b64).digest("hex").slice(0, 16);
}

console.log("S2: request #1 with seed", SEED);
const a = await generateImage({ prompt, originalImages: [garment], extra: { seed: SEED } });
console.log("  status:", a.status, "ok:", a.ok);

if (a.status >= 400 && a.status < 500) {
  console.log("\nRESULT: REJECTED — endpoint 4xx'd on the unknown `seed` field.");
  console.log("  -> Confirms the Connect-RPC risk. Production correctly sends no seed.");
  console.log("  body:", a.text.slice(0, 300));
  process.exit(0);
}
if (!a.ok) { console.error("non-4xx error:", a.status, a.text.slice(0, 300)); process.exit(2); }

console.log("S2: request #2 with same seed", SEED);
const b = await generateImage({ prompt, originalImages: [garment], extra: { seed: SEED } });
const ha = hashOf(a.json), hb = hashOf(b.json);
console.log("  hashes:", ha, hb);
console.log(
  "\nRESULT:",
  ha && ha === hb
    ? "ACCEPTED + REPRODUCIBLE — same seed -> identical output (relight reproducibility available)."
    : "ACCEPTED but IGNORED — no 4xx, but same seed -> different output (seed silently ignored)."
);
console.log("REMINDER: do NOT leave seed on any production request regardless of this result.");
