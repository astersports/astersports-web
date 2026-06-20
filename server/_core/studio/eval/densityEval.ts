/**
 * PHASE C — Density eval harness (offline; no UI, no router). Mirrors recolorEval.
 *
 * Run:  npx tsx server/_core/studio/eval/densityEval.ts [path/to/manifest.json]
 *
 * Offline by design: each case supplies a local garment image, a fabric
 * truth-mask PNG, and an instance LABEL-MAP PNG (each distinct non-near-black
 * colour = one motif instance). The op runs on REAL rasters WITHOUT live SAM2
 * (density HARD-REQUIRES a fabric raster + instance masks). The label map is the
 * metric's truth (counts + survivor integrity + evenness); bgDeltaE is the
 * D1/mask signal, reported but EXCLUDED from verdict.pass per the ruling.
 *
 * verdict.pass = countError && survivorIntegrity && evenness && infillCleanliness.
 * Manifest: DensityEvalCase[] (see eval/samples/density.manifest.example.json).
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { decodeUpright } from "../../image/decodeUpright";
import { densityThin } from "../ops/densityThin";
import { computeDensityMetrics, densityVerdict, type DensityMetrics } from "./densityMetrics";
import { loadFabricMask, loadInstanceLabelMap, saveSideBySide } from "./evalMaskIO";
import type { FabricMask } from "../../masking/types";

export interface DensityEvalCase {
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

export interface DensityEvalRow {
  id: string;
  removed?: number;
  instances?: number;
  metrics?: DensityMetrics;
  verdict?: ReturnType<typeof densityVerdict>;
  deterministic?: boolean;
  artifact?: string;
  error?: string;
}

/** Run one case end-to-end: load masks -> op -> metric -> verdict (+ determinism). */
export async function runDensityCase(c: DensityEvalCase): Promise<DensityEvalRow> {
  try {
    const { buffer: src, width, height } = await decodeUpright(c.imageUrl);
    const { raster, membership, bbox } = await loadFabricMask(c.maskUrl, width, height);
    const { labels, instances } = await loadInstanceLabelMap(c.labelUrl, width, height);
    const fabric: FabricMask = { bbox, confidence: 1, raster, provider: "sam2" };

    const r1 = await densityThin({ image: { url: c.imageUrl }, fabric, instances, percent: c.percent });
    const r2 = await densityThin({ image: { url: c.imageUrl }, fabric, instances, percent: c.percent });
    const deterministic = Buffer.compare(r1.data, r2.data) === 0;

    const metrics = computeDensityMetrics({
      source: src,
      out: r1.data,
      width,
      height,
      truthMask: membership,
      truthInstanceLabels: labels,
      targetRemovalFraction: c.percent / 100,
    });
    const verdict = densityVerdict(metrics);

    const outPng = await sharp(r1.data, { raw: { width, height, channels: 4 } }).png().toBuffer();
    const artifact = await saveSideBySide(src, width, height, outPng, `density-${c.id}`);
    return { id: c.id, removed: r1.removed, instances: instances.length, metrics, verdict, deterministic, artifact };
  } catch (err) {
    return { id: c.id, error: err instanceof Error ? err.message : String(err) };
  }
}

async function main() {
  const manifestPath = process.argv[2] || "eval/samples/density.manifest.json";
  const cases: DensityEvalCase[] = JSON.parse(await readFile(manifestPath, "utf8"));
  if (cases.length === 0) {
    console.log(`No cases in ${manifestPath}. Populate it (see eval/samples/density.manifest.example.json).`);
    return;
  }

  const rows: DensityEvalRow[] = [];
  for (const c of cases) rows.push(await runDensityCase(c));

  let countP = 0, survP = 0, evenP = 0, infP = 0, det = 0, pass = 0;
  const n = rows.length;
  console.log("\n=== DENSITY EVAL ===");
  console.log("id | inst | removed | countErr | survΔE | evenness | infill | bgΔE | verdict | det | artifact");
  for (const r of rows) {
    if (r.error) { console.log(`${r.id} | ERROR | ${r.error}`); continue; }
    const m = r.metrics!, v = r.verdict!;
    if (v.countPass) countP++;
    if (v.survivorPass) survP++;
    if (v.evennessPass) evenP++;
    if (v.infillPass) infP++;
    if (r.deterministic) det++;
    if (v.pass) pass++;
    console.log([
      r.id,
      String(r.instances),
      String(r.removed),
      m.countError.toFixed(3),
      m.survivorIntegrity.toFixed(2),
      m.evenness.toFixed(2),
      m.infillCleanliness.toFixed(2),
      m.bgDeltaE.toFixed(2),
      v.pass ? "PASS" : "FAIL",
      r.deterministic ? "det" : "NONDET",
      r.artifact ? path.relative(process.cwd(), r.artifact) : "-",
    ].join(" | "));
  }
  console.log("\n--- aggregate (verdict = count && survivor && evenness && infill; bg is the D1/mask signal, EXCLUDED) ---");
  console.log(`countError<=.10      : ${countP}/${n}`);
  console.log(`survivorIntegrity<=2 : ${survP}/${n}`);
  console.log(`evenness<=1.5        : ${evenP}/${n}`);
  console.log(`infillCleanliness<=2.5: ${infP}/${n}`);
  console.log(`deterministic        : ${det}/${n}`);
  console.log(`PASS                 : ${pass}/${n}`);
  console.log("\nNOTE: bgDeltaE (background change on a loose raster) is reported, not in pass. PNGs are primary.");
}

// Run main() only when invoked directly (not when imported by a test).
if (process.argv[1] && path.basename(process.argv[1]).includes("densityEval")) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
