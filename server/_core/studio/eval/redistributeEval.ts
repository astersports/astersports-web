/**
 * Density v2 (Option B) eval harness (offline; no UI, no router). Mirrors
 * densityEval.ts.
 *
 * Run:  npx tsx server/_core/studio/eval/redistributeEval.ts [path/to/manifest.json]
 *
 * Offline by design: each case supplies a garment image, a fabric truth-mask PNG,
 * and an instance LABEL-MAP PNG (each distinct non-near-black colour = one motif
 * instance). The op runs on REAL rasters WITHOUT live SAM2. The label map is the
 * metric's truth (count + per-motif + scale + ghosting); bgDeltaE is the D1/mask
 * signal, reported but EXCLUDED from verdict.pass.
 *
 * If the manifest's assets are missing, a deterministic synthetic fixture is
 * generated under eval/out (gitignored) so the harness is self-contained.
 *
 * verdict.pass = countError && evenness(NNI) && palette && perMotif && scale && ghosting && !no-op.
 */
import { readFile, access } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { decodeUpright } from "../../image/decodeUpright";
import { densityRedistribute } from "../ops/densityRedistribute";
import { computeRedistributeMetrics, redistributeVerdict, type RedistributeMetrics } from "./redistributeMetrics";
import { loadFabricMask, loadInstanceLabelMap, saveSideBySide, EVAL_OUT_DIR } from "./evalMaskIO";
import { ensureRedistributeFixture } from "./genRedistributeFixture";
import type { FabricMask } from "../../masking/types";

export interface RedistributeEvalCase {
  id: string;
  imageUrl: string;
  /** Removal percent, 0..90. targetRemovalFraction = percent / 100. */
  percent: number;
  /** Local fabric truth-mask PNG (REQUIRED — bounds the op + ground sampling). */
  maskUrl: string;
  /** Local instance label-map PNG (REQUIRED — distinct colour per motif). */
  labelUrl: string;
  note?: string;
}

export interface RedistributeEvalRow {
  id: string;
  kept?: number;
  removed?: number;
  instances?: number;
  metrics?: RedistributeMetrics;
  verdict?: ReturnType<typeof redistributeVerdict>;
  deterministic?: boolean;
  artifact?: string;
  error?: string;
}

/** Run one case end-to-end: load masks -> op (×2 for determinism) -> metric -> verdict. */
export async function runRedistributeCase(c: RedistributeEvalCase): Promise<RedistributeEvalRow> {
  try {
    const { buffer: src, width, height } = await decodeUpright(c.imageUrl);
    const { raster, membership, bbox } = await loadFabricMask(c.maskUrl, width, height);
    const { labels, instances } = await loadInstanceLabelMap(c.labelUrl, width, height);
    // For offline eval, the fabric raster IS the boundary (full-white = full image)
    const fabric: FabricMask = { bbox, confidence: 1, raster, boundaryRaster: raster, provider: "sam2" };

    const r1 = await densityRedistribute({ image: { url: c.imageUrl }, fabric, instances, percent: c.percent });
    const r2 = await densityRedistribute({ image: { url: c.imageUrl }, fabric, instances, percent: c.percent });
    const deterministic = Buffer.compare(r1.data, r2.data) === 0;

    const metrics = computeRedistributeMetrics({
      source: src,
      out: r1.data,
      width,
      height,
      truthMask: membership,
      truthInstanceLabels: labels,
      targets: r1.targets,
      assignments: r1.assignments,
      removed: r1.removed,
      targetRemovalFraction: c.percent / 100,
    });
    const verdict = redistributeVerdict(metrics, r1.removed, { placementEvennessMax: 1.9 });

    const outPng = await sharp(r1.data, { raw: { width, height, channels: 4 } }).png().toBuffer();
    const artifact = await saveSideBySide(src, width, height, outPng, `redistribute-${c.id}`);
    return { id: c.id, kept: r1.kept, removed: r1.removed, instances: instances.length, metrics, verdict, deterministic, artifact };
  } catch (err) {
    return { id: c.id, error: err instanceof Error ? err.message : String(err) };
  }
}

async function fileExists(p: string): Promise<boolean> {
  try { await access(p); return true; } catch { return false; }
}

/** Ensure every asset a case references exists; generate the synthetic fixture if not. */
async function ensureAssets(cases: RedistributeEvalCase[]): Promise<void> {
  const missing = [];
  for (const c of cases) {
    for (const u of [c.imageUrl, c.maskUrl, c.labelUrl]) {
      if (!u.startsWith("http") && !(await fileExists(u))) missing.push(u);
    }
  }
  if (missing.length === 0) return;
  console.log(`[redistribute-eval] generating synthetic fixture (${missing.length} asset(s) missing) -> ${EVAL_OUT_DIR}`);
  await ensureRedistributeFixture(EVAL_OUT_DIR);
}

async function main() {
  const manifestPath = process.argv[2] || "eval/samples/redistribute.manifest.json";
  const cases: RedistributeEvalCase[] = JSON.parse(await readFile(manifestPath, "utf8"));
  if (cases.length === 0) {
    console.log(`No cases in ${manifestPath}.`);
    return;
  }
  await ensureAssets(cases);

  const rows: RedistributeEvalRow[] = [];
  for (const c of cases) rows.push(await runRedistributeCase(c));

  let countP = 0, evenP = 0, palP = 0, motP = 0, sclP = 0, infP = 0, det = 0, pass = 0;
  const n = rows.length;
  console.log("\n=== DENSITY v2 (OPTION B) REDISTRIBUTION EVAL ===");
  console.log("id | inst | kept | removed | countErr | NNI | palΔE | motifΔE | scaleErr | ghost | bgΔE | verdict | det");
  for (const r of rows) {
    if (r.error) { console.log(`${r.id} | ERROR | ${r.error}`); continue; }
    const m = r.metrics!, v = r.verdict!;
    if (v.countPass) countP++;
    if (v.evennessPass) evenP++;
    if (v.palettePass) palP++;
    if (v.perMotifPass) motP++;
    if (v.scalePass) sclP++;
    if (v.infillPass) infP++;
    if (r.deterministic) det++;
    if (v.pass) pass++;
    console.log([
      r.id,
      String(r.instances),
      String(r.kept),
      String(r.removed),
      m.countError.toFixed(3),
      m.placementEvenness.toFixed(2),
      m.palette.toFixed(2),
      m.perMotif.toFixed(2),
      m.scaleFidelity.toFixed(3),
      m.infillCleanliness.toFixed(2),
      m.bgDeltaE.toFixed(2),
      v.pass ? "PASS" : "FAIL",
      r.deterministic ? "det" : "NONDET",
    ].join(" | "));
  }
  console.log("\n--- aggregate (pass = count && evenness && palette && perMotif && scale && ghosting && !no-op; bg EXCLUDED) ---");
  console.log(`countError<=.10        : ${countP}/${n}`);
  console.log(`placementEvenness>=1.0 : ${evenP}/${n}`);
  console.log(`palette<=5             : ${palP}/${n}`);
  console.log(`perMotif<=3            : ${motP}/${n}`);
  console.log(`scaleFidelity<=.05     : ${sclP}/${n}`);
  console.log(`ghosting<=2.5          : ${infP}/${n}`);
  console.log(`deterministic          : ${det}/${n}`);
  console.log(`PASS                   : ${pass}/${n}`);

  const allPass = rows.every((r) => r.verdict?.pass);
  if (!allPass) process.exitCode = 1;
}

// Run main() only when invoked directly (not when imported by a test).
if (process.argv[1] && path.basename(process.argv[1]).includes("redistributeEval")) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
