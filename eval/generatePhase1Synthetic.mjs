/**
 * Phase-1 synthetic fixtures — the RIGOROUS, non-gameable ground truth.
 *
 * Real garments have folds/drape that occlude motifs, so a hand "true count" is
 * inherently fuzzy (approximate-real validation only). These synthetic SCATTERED
 * scenes have a KNOWN exact motif count placed at RANDOM (aperiodic) positions —
 * the right truth for:
 *   - density count fidelity (remove p% of a known N; exact),
 *   - segmenter detection (does the classical counter recover the known N?),
 *   - scale detector recall (aperiodic all-over coverage must be ACCEPTED).
 *
 * Aperiodic on purpose: a tossed/scattered print is density's sweet spot but the
 * FFT scale guard's blind spot (strategy §1) — these fixtures exercise exactly that.
 *
 * Deterministic: a fixed-seed PRNG (no Math.random) so regenerating is reproducible.
 * Output: eval/samples/phase1/<id>-scene.png / -raster.png / -instances.png and a
 * phase1.synthetic.json manifest (records the exact truth count per fixture).
 *
 * Run: node eval/generatePhase1Synthetic.mjs
 */
import sharp from "sharp";
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const OUT = "eval/samples/phase1";
mkdirSync(OUT, { recursive: true });

// ─── deterministic PRNG (mulberry32) ───────────────────────────────────────
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const GROUND = [225, 220, 205];           // light beige fabric
const MOTIF = [62, 42, 48];               // dark motif (high contrast, like Stassie)

function buf(W, H, color) {
  const b = Buffer.alloc(W * H * 4);
  for (let i = 0; i < W * H; i++) { const p = i * 4; b[p] = color[0]; b[p + 1] = color[1]; b[p + 2] = color[2]; b[p + 3] = 255; }
  return b;
}
/** distinct, non-near-black label colour per instance id (golden-angle hue). */
function labelColor(id) {
  const h = (id * 137.508) % 360, c = 1, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = 0.18;
  let r, g, bl;
  if (h < 60) [r, g, bl] = [c, x, 0]; else if (h < 120) [r, g, bl] = [x, c, 0];
  else if (h < 180) [r, g, bl] = [0, c, x]; else if (h < 240) [r, g, bl] = [0, x, c];
  else if (h < 300) [r, g, bl] = [x, 0, c]; else [r, g, bl] = [c, 0, x];
  return [Math.round((r + m) * 220) + 30, Math.round((g + m) * 220) + 30, Math.round((bl + m) * 220) + 30];
}

/**
 * Place N round motifs at random positions. minDist>0 enforces non-overlap
 * (Poisson-disk-ish via rejection). Returns {scene, raster, instances, placed}.
 */
function scatter(W, H, N, radius, seed, minDist) {
  const rand = rng(seed);
  const scene = buf(W, H, GROUND);
  const raster = buf(W, H, [255, 255, 255]); // full-image fabric
  const instances = buf(W, H, [0, 0, 0]);    // ground = black
  const centers = [];
  const margin = radius + 2;
  let attempts = 0;
  while (centers.length < N && attempts < N * 400) {
    attempts++;
    const cx = margin + Math.floor(rand() * (W - 2 * margin));
    const cy = margin + Math.floor(rand() * (H - 2 * margin));
    if (minDist > 0 && centers.some(([x, y]) => (x - cx) ** 2 + (y - cy) ** 2 < minDist * minDist)) continue;
    centers.push([cx, cy]);
  }
  centers.forEach(([cx, cy], id) => {
    const lc = labelColor(id);
    for (let y = cy - radius; y <= cy + radius; y++) for (let x = cx - radius; x <= cx + radius; x++) {
      if (x < 0 || x >= W || y < 0 || y >= H) continue;
      if ((x - cx) ** 2 + (y - cy) ** 2 <= radius * radius) {
        const p = (y * W + x) * 4;
        scene[p] = MOTIF[0]; scene[p + 1] = MOTIF[1]; scene[p + 2] = MOTIF[2];
        instances[p] = lc[0]; instances[p + 1] = lc[1]; instances[p + 2] = lc[2];
      }
    }
  });
  return { scene, raster, instances, placed: centers.length };
}

async function savePng(b, W, H, file) { await sharp(b, { raw: { width: W, height: H, channels: 4 } }).png().toFile(file); }

const manifest = [];
async function emit(id, W, H, N, radius, seed, minDist, note) {
  const r = scatter(W, H, N, radius, seed, minDist);
  await savePng(r.scene, W, H, path.join(OUT, `${id}-scene.png`));
  await savePng(r.raster, W, H, path.join(OUT, `${id}-raster.png`));
  await savePng(r.instances, W, H, path.join(OUT, `${id}-instances.png`));
  manifest.push({
    id, scene: `${OUT}/${id}-scene.png`, raster: `${OUT}/${id}-raster.png`,
    instances: `${OUT}/${id}-instances.png`, trueCount: r.placed, requestedCount: N,
    radius, minDist, scatter: true, note,
  });
  console.log(`${id}: placed ${r.placed}/${N} (r=${radius}, minDist=${minDist})`);
}

const W = 600, H = 600;
// Clean discrete (well-separated) — segmenter SHOULD recover N within ±10%.
await emit("scat-sparse-30", W, H, 30, 9, 101, 46, "clean discrete, N=30, well separated");
await emit("scat-sparse-60", W, H, 60, 8, 202, 34, "clean discrete, N=60, well separated");
await emit("scat-sparse-90", W, H, 90, 7, 303, 26, "clean discrete, N=90, moderately dense");
// Dense / touching — segmenter WILL undercount (records the classical ceiling → needs SAM2).
await emit("scat-dense-120", W, H, 120, 8, 404, 0, "dense/overlapping, N=120 — classical CC ceiling");

writeFileSync(path.join(OUT, "phase1.synthetic.json"), JSON.stringify(manifest, null, 2));
console.log(`\nwrote ${manifest.length} fixtures + phase1.synthetic.json`);
