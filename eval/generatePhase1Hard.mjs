/**
 * HARD synthetic fixtures — the adversarial audit. The Round-1 fixtures were the
 * EASY case (well-separated, two-colour, high-contrast) — which is NOT how real prints
 * look. These encode the failure modes a real Cinq à Sept / LIKELY print actually has,
 * each with a KNOWN exact motif count so we can measure how each metric degrades:
 *   - overlap/bunching  (motifs touch → connected-components merge them)
 *   - multicolour motifs (each floret a different colour)
 *   - varied ground     (two-tone / gradient ground breaks the single-median assumption)
 *   - low contrast      (motif ΔE to ground shrinks → foreground detection fails)
 *
 * Deterministic (seeded PRNG). Output: eval/samples/phase1-hard/<id>-{scene,raster,
 * instances}.png + phase1.hard.json (records trueCount + condition per fixture).
 *
 * Run: node eval/generatePhase1Hard.mjs
 */
import sharp from "sharp";
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const OUT = "eval/samples/phase1-hard";
mkdirSync(OUT, { recursive: true });
const W = 600, H = 600;

function rng(seed) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function labelColor(id) {
  const h = (id * 137.508) % 360, c = 1, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = 0.18;
  let r, g, bl;
  if (h < 60) [r, g, bl] = [c, x, 0]; else if (h < 120) [r, g, bl] = [x, c, 0];
  else if (h < 180) [r, g, bl] = [0, c, x]; else if (h < 240) [r, g, bl] = [0, x, c];
  else if (h < 300) [r, g, bl] = [x, 0, c]; else [r, g, bl] = [c, 0, x];
  return [Math.round((r + m) * 220) + 30, Math.round((g + m) * 220) + 30, Math.round((bl + m) * 220) + 30];
}
// motif palette (multicolour florals: pinks/yellows/reds/greens like the real prints)
const PALETTE = [[210, 70, 110], [240, 200, 70], [200, 50, 60], [120, 160, 90], [150, 90, 170], [230, 120, 80]];

function groundFill(kind, gA, gB) {
  const b = Buffer.alloc(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const p = (y * W + x) * 4; let c = gA;
    if (kind === "twotone") c = (x < W / 2) ? gA : gB;
    else if (kind === "gradient") { const t = (x + y) / (2 * W); c = [gA[0] + (gB[0] - gA[0]) * t, gA[1] + (gB[1] - gA[1]) * t, gA[2] + (gB[2] - gA[2]) * t]; }
    b[p] = c[0]; b[p + 1] = c[1]; b[p + 2] = c[2]; b[p + 3] = 255;
  }
  return b;
}

/**
 * Place N motifs. opts: radius, minDistMul (×r; <2 overlaps), multicolour (per-motif
 * palette colour) or fixed motifColor, ground kind/colours.
 */
function build({ N, radius, minDistMul, seed, multicolour, motifColor, groundKind, gA, gB }) {
  const rand = rng(seed);
  const scene = groundFill(groundKind, gA, gB);
  const raster = Buffer.alloc(W * H * 4); for (let i = 0; i < W * H; i++) { raster[i * 4] = 255; raster[i * 4 + 1] = 255; raster[i * 4 + 2] = 255; raster[i * 4 + 3] = 255; }
  const instances = Buffer.alloc(W * H * 4); for (let i = 0; i < W * H; i++) instances[i * 4 + 3] = 255;
  const centers = []; const margin = radius + 2; const minDist = minDistMul * radius; let guard = 0;
  while (centers.length < N && guard++ < N * 600) {
    const cx = margin + Math.floor(rand() * (W - 2 * margin)), cy = margin + Math.floor(rand() * (H - 2 * margin));
    if (minDist > 0 && centers.some(([x, y]) => (x - cx) ** 2 + (y - cy) ** 2 < minDist * minDist)) continue;
    centers.push([cx, cy]);
  }
  centers.forEach(([cx, cy], id) => {
    const mc = multicolour ? PALETTE[id % PALETTE.length] : motifColor;
    const lc = labelColor(id);
    for (let y = cy - radius; y <= cy + radius; y++) for (let x = cx - radius; x <= cx + radius; x++) {
      if (x < 0 || x >= W || y < 0 || y >= H) continue;
      if ((x - cx) ** 2 + (y - cy) ** 2 <= radius * radius) {
        const p = (y * W + x) * 4;
        scene[p] = mc[0]; scene[p + 1] = mc[1]; scene[p + 2] = mc[2];
        // instance label: only paint where not already painted (so overlaps keep the
        // FIRST motif's label — mirrors how a human counts the visible blob count;
        // overlapping motifs that fully merge are genuinely ambiguous).
        if (instances[p] === 0 && instances[p + 1] === 0 && instances[p + 2] === 0) { instances[p] = lc[0]; instances[p + 1] = lc[1]; instances[p + 2] = lc[2]; }
      }
    }
  });
  return { scene, raster, instances, placed: centers.length };
}

async function savePng(b, file) { await sharp(b, { raw: { width: W, height: H, channels: 4 } }).png().toFile(file); }
const manifest = [];
async function emit(id, condition, opts, note) {
  const r = build(opts);
  await savePng(r.scene, path.join(OUT, `${id}-scene.png`));
  await savePng(r.raster, path.join(OUT, `${id}-raster.png`));
  await savePng(r.instances, path.join(OUT, `${id}-instances.png`));
  manifest.push({ id, condition, scene: `${OUT}/${id}-scene.png`, raster: `${OUT}/${id}-raster.png`, instances: `${OUT}/${id}-instances.png`, trueCount: r.placed, note });
  console.log(`${id} [${condition}]: ${r.placed} motifs`);
}

const BEIGE = [225, 220, 205], DARK = [50, 45, 55], CREAM = [232, 226, 210];
// 1) OVERLAP / BUNCHING — same N, shrinking separation.
await emit("overlap-sep", "overlap", { N: 60, radius: 9, minDistMul: 2.4, seed: 1, motifColor: DARK, groundKind: "flat", gA: BEIGE }, "well separated (control)");
await emit("overlap-touch", "overlap", { N: 60, radius: 12, minDistMul: 1.3, seed: 1, motifColor: DARK, groundKind: "flat", gA: BEIGE }, "motifs touch");
await emit("overlap-heavy", "overlap", { N: 60, radius: 16, minDistMul: 0.8, seed: 1, motifColor: DARK, groundKind: "flat", gA: BEIGE }, "heavy overlap (bunched)");
// 2) MULTICOLOUR motifs on a plain ground.
await emit("multicolor-sep", "multicolor", { N: 60, radius: 10, minDistMul: 2.2, seed: 2, multicolour: true, groundKind: "flat", gA: CREAM }, "each motif a different colour");
await emit("multicolor-bunched", "multicolor", { N: 70, radius: 13, minDistMul: 1.1, seed: 2, multicolour: true, groundKind: "flat", gA: CREAM }, "multicolour + bunched (real-floral-like)");
// 3) VARIED GROUND (breaks single-median ground).
await emit("ground-twotone", "varied-ground", { N: 60, radius: 10, minDistMul: 2.2, seed: 3, motifColor: DARK, groundKind: "twotone", gA: [235, 225, 205], gB: [120, 130, 150] }, "two-tone ground");
await emit("ground-gradient", "varied-ground", { N: 60, radius: 10, minDistMul: 2.2, seed: 3, motifColor: DARK, groundKind: "gradient", gA: [235, 225, 205], gB: [120, 110, 130] }, "gradient ground");
// 4) LOW CONTRAST (motif ΔE to ground shrinks).
await emit("contrast-hi", "low-contrast", { N: 60, radius: 10, minDistMul: 2.2, seed: 4, motifColor: [60, 50, 60], groundKind: "flat", gA: BEIGE }, "high contrast (control)");
await emit("contrast-mid", "low-contrast", { N: 60, radius: 10, minDistMul: 2.2, seed: 4, motifColor: [180, 175, 165], groundKind: "flat", gA: BEIGE }, "mid contrast");
await emit("contrast-low", "low-contrast", { N: 60, radius: 10, minDistMul: 2.2, seed: 4, motifColor: [210, 206, 196], groundKind: "flat", gA: BEIGE }, "low contrast (silver-on-cream-like)");

writeFileSync(path.join(OUT, "phase1.hard.json"), JSON.stringify(manifest, null, 2));
console.log(`\nwrote ${manifest.length} hard fixtures + phase1.hard.json`);
