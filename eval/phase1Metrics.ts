/**
 * PHASE-1 METRICS HARNESS — one runnable that scores the three Phase-1 metrics and
 * prints a Markdown table for docs/PHASE1_PROGRESS.md.
 *
 *   M1 density count fidelity — pipeline removes the requested fraction within ±10%
 *      (relative). RIGOROUS bar = synthetic scattered fixtures (known exact N).
 *   M2 segmenter detection — classical count within ±10% of truth on clean discrete
 *      motifs. RIGOROUS bar = synthetic sparse fixtures (known N). Dense/overlapping
 *      reported as the classical CEILING ("needs SAM2"), not counted against the bar.
 *   M3 scale detector recall — detectRepeat ACCEPTS ≥90% of genuine all-over/scattered
 *      prints while NEVER accepting a placement/border (0 false-accepts).
 *
 * Real images are APPROXIMATE validation (folds/drape make a hand truth fuzzy) — the
 * credentialed SAM2 run is the real gate. Real rows are reported; only synthetic rows
 * (exact truth) gate M1/M2. M3 uses both synthetic and labeled real images.
 *
 * Run: npx tsx eval/phase1Metrics.ts            (table to stdout)
 *      npx tsx eval/phase1Metrics.ts --json     (machine-readable)
 */
import { readFile } from "node:fs/promises";
import sharp from "sharp";
import { decodeUpright } from "../server/_core/image/decodeUpright";
import { densityThin } from "../server/_core/studio/ops/densityThin";
import { loadFabricMask, loadInstanceLabelMap } from "../server/_core/studio/eval/evalMaskIO";
import { detectRepeat } from "../server/_core/studio/ops/repeatDetector";
import { runDetectorEval } from "../server/_core/studio/eval/detectorAccuracy";
import { segmentMotifs, type SegmentOptions } from "./segmentMotifs";
import type { BBoxNormalized } from "../server/_core/masking/types";

const REL_TOL = 0.10; // ±10% relative
const DENSITY_PERCENTS = [30, 50];

interface SynthFixture {
  id: string; scene: string; raster: string; instances: string;
  trueCount: number; radius: number; minDist: number; note: string;
}

// ── Real eval cases (committed config). clean=metric-2 candidate; scaleLabel gates M3.
interface RealCase {
  id: string; image: string; bbox: BBoxNormalized; seg: SegmentOptions;
  clean: boolean; scaleLabel: "scattered" | "placed" | "lace" | "solid";
  handCount?: number; // approximate, validation only
}
const DIR = "eval/samples/cinqasept-likely";
const REAL: RealCase[] = [
  { id: "poppette-dots", image: `${DIR}/scattered__likely__poppette-dress__flatlay.jpg`, bbox: { x: 0.2, y: 0.55, w: 0.6, h: 0.38 }, seg: { deltaE: 18, maxAreaFrac: 0.012, minAreaFrac: 0.0003 }, clean: true, scaleLabel: "scattered", handCount: 95 },
  { id: "stassie-dots", image: `${DIR}/scattered__cinqasept__stassie-dress__flatlay.jpg`, bbox: { x: 0.18, y: 0.45, w: 0.64, h: 0.30 }, seg: { deltaE: 28, maxAreaFrac: 0.02, minAreaFrac: 0.0008 }, clean: true, scaleLabel: "scattered", handCount: 48 },
  { id: "pindot", image: `${DIR}/scattered__cinqasept__pindot-galea-dress__flatlay.jpg`, bbox: { x: 0.28, y: 0.52, w: 0.44, h: 0.28 }, seg: { deltaE: 14, maxAreaFrac: 0.01, minAreaFrac: 0.00015 }, clean: true, scaleLabel: "scattered" },
  { id: "ditsy-marullo", image: `${DIR}/scattered__likely__ditsy-floral-marullo-dress__flatlay.jpg`, bbox: { x: 0.16, y: 0.18, w: 0.68, h: 0.6 }, seg: { deltaE: 16, maxAreaFrac: 0.02, minAreaFrac: 0.0005 }, clean: true, scaleLabel: "scattered" },
  { id: "tessa-roses", image: `${DIR}/scattered__likely__tessa-gown__flatlay.jpg`, bbox: { x: 0.18, y: 0.42, w: 0.64, h: 0.5 }, seg: { deltaE: 30, maxAreaFrac: 0.03 }, clean: false, scaleLabel: "scattered" },
  { id: "tossed-floral-walker", image: `${DIR}/scattered__cinqasept__tossed-floral-walker-dress__flatlay.jpg`, bbox: { x: 0.2, y: 0.4, w: 0.6, h: 0.5 }, seg: { deltaE: 22, maxAreaFrac: 0.05 }, clean: false, scaleLabel: "scattered" },
  { id: "trailing-peonies", image: `${DIR}/scattered__cinqasept__trailing-peonies-maude-dress__flatlay.jpg`, bbox: { x: 0.2, y: 0.35, w: 0.6, h: 0.55 }, seg: { deltaE: 22, maxAreaFrac: 0.05 }, clean: false, scaleLabel: "scattered" },
  { id: "garden-doodle", image: `${DIR}/scattered__cinqasept__garden-doodle-betsy-jean-short__flatlay.jpg`, bbox: { x: 0.2, y: 0.35, w: 0.6, h: 0.45 }, seg: { deltaE: 18, maxAreaFrac: 0.08 }, clean: false, scaleLabel: "scattered" },
  // placed / embellished — MUST be rejected by the scale detector (0 false-accepts)
  { id: "sunflare-trim", image: `${DIR}/embellished__cinqasept__sunflare-aanya-jacket__onmodel.jpg`, bbox: { x: 0.3, y: 0.3, w: 0.4, h: 0.45 }, seg: { deltaE: 22 }, clean: false, scaleLabel: "placed" },
  { id: "corded-bow", image: `${DIR}/embellished__cinqasept__corded-rhinestone-bow-rella-dress__flatlay.jpg`, bbox: { x: 0.3, y: 0.25, w: 0.4, h: 0.4 }, seg: { deltaE: 22 }, clean: false, scaleLabel: "placed" },
  { id: "daria-neckline", image: `${DIR}/embellished__likely__daria-dress__flatlay.jpg`, bbox: { x: 0.25, y: 0.3, w: 0.5, h: 0.5 }, seg: { deltaE: 22 }, clean: false, scaleLabel: "placed" },
];

const WORK = 600; // working width for real detector/segmenter runs

async function loadSynth(): Promise<SynthFixture[]> {
  return JSON.parse(await readFile("eval/samples/phase1/phase1.synthetic.json", "utf8"));
}

// ── M1: density count fidelity on synthetic (truth instances) ───────────────
async function metric1(synth: SynthFixture[]) {
  const rows: { id: string; percent: number; trueCount: number; removed: number; actual: number; target: number; pass: boolean }[] = [];
  for (const f of synth) {
    const { buffer, width, height } = await decodeUpright(f.scene);
    const { raster, bbox } = await loadFabricMask(f.raster, width, height);
    const { instances } = await loadInstanceLabelMap(f.instances, width, height);
    for (const percent of DENSITY_PERCENTS) {
      const r = await densityThin({ image: { url: f.scene }, fabric: { bbox, confidence: 1, provider: "sam2", raster }, instances, percent });
      const actual = instances.length ? r.removed / instances.length : 0;
      const target = percent / 100;
      rows.push({ id: f.id, percent, trueCount: instances.length, removed: r.removed, actual, target, pass: Math.abs(actual - target) <= REL_TOL * target });
    }
  }
  return rows;
}

// ── M2: segmenter detection vs known N (synthetic) + approx real ────────────
async function metric2(synth: SynthFixture[]) {
  const synthRows: { id: string; trueCount: number; detected: number; relErr: number; dense: boolean; pass: boolean }[] = [];
  for (const f of synth) {
    const dense = f.minDist === 0;
    const r = await segmentMotifs(f.scene, { deltaE: 20, minAreaFrac: 0.0002, maxAreaFrac: 0.02 });
    const relErr = Math.abs(r.count - f.trueCount) / f.trueCount;
    synthRows.push({ id: f.id, trueCount: f.trueCount, detected: r.count, relErr, dense, pass: relErr <= REL_TOL });
  }
  const realRows: { id: string; handCount?: number; detected: number; relErr?: number; clean: boolean }[] = [];
  for (const c of REAL) {
    if (c.scaleLabel === "placed") continue;
    const r = await segmentMotifs(c.image, { bbox: c.bbox, ...c.seg });
    const relErr = c.handCount ? Math.abs(r.count - c.handCount) / c.handCount : undefined;
    realRows.push({ id: c.id, handCount: c.handCount, detected: r.count, relErr, clean: c.clean });
  }
  return { synthRows, realRows };
}

// ── M3: scale detector recall (accept scattered) + safety (reject placed) ───
async function buildRectRaster(W: number, H: number, bb: BBoxNormalized): Promise<Uint8Array> {
  const d = new Uint8Array(W * H);
  const x0 = Math.floor(bb.x * W), y0 = Math.floor(bb.y * H), x1 = Math.ceil((bb.x + bb.w) * W), y1 = Math.ceil((bb.y + bb.h) * H);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) d[y * W + x] = 255;
  return d;
}
async function metric3(synth: SynthFixture[]) {
  const rows: { id: string; group: string; want: "accept" | "reject"; got: string; accept: boolean; correct: boolean }[] = [];
  // synthetic scattered (aperiodic all-over) — must ACCEPT
  for (const f of synth) {
    const { buffer, width, height } = await decodeUpright(f.scene);
    const { raster } = await loadFabricMask(f.raster, width, height);
    const res = detectRepeat(buffer, width, height, raster.data);
    rows.push({ id: f.id, group: "synthetic-scattered", want: "accept", got: res.classification, accept: res.isAllover, correct: res.isAllover });
  }
  // synthetic periodic + placement/border (existing corpus)
  for (const r of runDetectorEval().rows) {
    rows.push({ id: r.name, group: r.kind === "allover" ? "synthetic-periodic" : "synthetic-" + r.kind, want: r.wantAccept ? "accept" : "reject", got: r.classification, accept: r.accept, correct: r.correct });
  }
  // real labeled
  for (const c of REAL) {
    if (c.scaleLabel === "lace" || c.scaleLabel === "solid") continue;
    const imgBuf = await sharp(c.image).resize(WORK).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const W = imgBuf.info.width, H = imgBuf.info.height;
    const raster = await buildRectRaster(W, H, c.bbox);
    const res = detectRepeat(imgBuf.data, W, H, raster);
    const want = c.scaleLabel === "scattered" ? "accept" : "reject";
    rows.push({ id: c.id, group: "real-" + c.scaleLabel, want, got: res.classification, accept: res.isAllover, correct: (want === "accept") === res.isAllover });
  }
  return rows;
}

function pct(n: number, d: number) { return d ? `${n}/${d} = ${((100 * n) / d).toFixed(0)}%` : "n/a"; }

async function main() {
  const synth = await loadSynth();
  const m1 = await metric1(synth);
  const m2 = await metric2(synth);
  const m3 = await metric3(synth);

  const m1pass = m1.filter((r) => r.pass).length;
  const m2synthClean = m2.synthRows.filter((r) => !r.dense);
  const m2pass = m2synthClean.filter((r) => r.pass).length;
  const m3accept = m3.filter((r) => r.want === "accept");
  const m3acceptPass = m3accept.filter((r) => r.correct).length;
  const m3falseAccept = m3.filter((r) => r.want === "reject" && r.accept);

  if (process.argv.includes("--json")) {
    console.log(JSON.stringify({ m1, m2, m3, summary: { m1: [m1pass, m1.length], m2: [m2pass, m2synthClean.length], m3recall: [m3acceptPass, m3accept.length], m3falseAccepts: m3falseAccept.length } }, null, 2));
    return;
  }

  console.log(`\n## M1 — density count fidelity (synthetic, exact truth) — ${pct(m1pass, m1.length)} pass (bar ≥90%)`);
  console.log("| fixture | N | ask% | removed | actual% | pass |");
  console.log("|---|--:|--:|--:|--:|:--:|");
  for (const r of m1) console.log(`| ${r.id} | ${r.trueCount} | ${r.percent} | ${r.removed} | ${(r.actual * 100).toFixed(1)} | ${r.pass ? "✅" : "❌"} |`);

  console.log(`\n## M2 — segmenter detection — clean synthetic ${pct(m2pass, m2synthClean.length)} pass (bar ≥90%)`);
  console.log("| fixture | trueN | detected | relErr% | type | pass |");
  console.log("|---|--:|--:|--:|---|:--:|");
  for (const r of m2.synthRows) console.log(`| ${r.id} | ${r.trueCount} | ${r.detected} | ${(r.relErr * 100).toFixed(1)} | ${r.dense ? "dense→needs SAM2" : "clean"} | ${r.dense ? "—" : r.pass ? "✅" : "❌"} |`);
  console.log("\n_Real (approximate validation; folds occlude → not gating):_");
  console.log("| real image | handCount~ | detected | relErr% | clean |");
  console.log("|---|--:|--:|--:|:--:|");
  for (const r of m2.realRows) console.log(`| ${r.id} | ${r.handCount ?? "?"} | ${r.detected} | ${r.relErr != null ? (r.relErr * 100).toFixed(0) : "?"} | ${r.clean ? "yes" : "no"} |`);

  console.log(`\n## M3 — scale detector — recall ${pct(m3acceptPass, m3accept.length)} (bar ≥90%) · false-accepts ${m3falseAccept.length} (bar 0)`);
  console.log("| case | group | want | got | accept | ok |");
  console.log("|---|---|---|---|:--:|:--:|");
  for (const r of m3) console.log(`| ${r.id} | ${r.group} | ${r.want} | ${r.got} | ${r.accept ? "Y" : "N"} | ${r.correct ? "✅" : "❌"} |`);

  console.log(`\n### SUMMARY  M1 ${pct(m1pass, m1.length)} · M2(clean synth) ${pct(m2pass, m2synthClean.length)} · M3 recall ${pct(m3acceptPass, m3accept.length)} · M3 false-accepts ${m3falseAccept.length}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
