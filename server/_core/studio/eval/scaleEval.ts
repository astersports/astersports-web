/**
 * PHASE B — Scale eval harness (offline; no UI, no router). Mirrors recolorEval.
 *
 * Run:  npx tsx server/_core/studio/eval/scaleEval.ts [path/to/manifest.json]
 *
 * Offline by design: each case supplies a local garment image + a fabric
 * truth-mask PNG, so the op runs on a REAL raster WITHOUT live SAM2 (scale
 * HARD-REQUIRES a fabric raster). The same mask is the metric's truth mask, so
 * poseBgDeltaE (background motion on a loose raster) is a real D1/mask signal —
 * reported, but EXCLUDED from verdict.pass per the ruling (op correctness =
 * scaleRatioError && paletteDeltaE). PNGs in eval/out are the primary arbiter.
 *
 * Manifest: ScaleEvalCase[] (see eval/samples/scale.manifest.example.json).
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { decodeUpright } from "../../image/decodeUpright";
import { scalePrintRepeat } from "../ops/scaleRepeat";
import { computeScaleMetrics, scaleVerdict, type ScaleMetrics } from "./scaleMetrics";
import { loadFabricMask, saveSideBySide } from "./evalMaskIO";
import type { FabricMask } from "../../masking/types";

export interface ScaleEvalCase {
  id: string;
  imageUrl: string;
  /** Signed scale percent; targetFraction = (100 + percent) / 100. */
  percent: number;
  /** Local fabric truth-mask PNG (REQUIRED — scale needs a raster). */
  maskUrl: string;
  note?: string;
}

export interface ScaleEvalRow {
  id: string;
  metrics?: ScaleMetrics;
  verdict?: ReturnType<typeof scaleVerdict>;
  deterministic?: boolean;
  artifact?: string;
  error?: string;
}

/** Run one case end-to-end: load mask -> op -> metric -> verdict (+ determinism). */
export async function runScaleCase(c: ScaleEvalCase): Promise<ScaleEvalRow> {
  try {
    const { buffer: src, width, height } = await decodeUpright(c.imageUrl);
    const { raster, membership, bbox } = await loadFabricMask(c.maskUrl, width, height);
    const fabric: FabricMask = { bbox, confidence: 1, raster, provider: "sam2" };
    const targetFraction = (100 + c.percent) / 100;

    const r1 = await scalePrintRepeat({ image: { url: c.imageUrl }, fabric, targetFraction });
    const r2 = await scalePrintRepeat({ image: { url: c.imageUrl }, fabric, targetFraction });
    const deterministic = Buffer.compare(r1.data, r2.data) === 0;

    const metrics = computeScaleMetrics({
      source: src,
      out: r1.data,
      width,
      height,
      truthMask: membership,
      targetFraction,
    });
    const verdict = scaleVerdict(metrics);

    const outPng = await sharp(r1.data, { raw: { width, height, channels: 4 } }).png().toBuffer();
    const artifact = await saveSideBySide(src, width, height, outPng, `scale-${c.id}`);
    return { id: c.id, metrics, verdict, deterministic, artifact };
  } catch (err) {
    return { id: c.id, error: err instanceof Error ? err.message : String(err) };
  }
}

async function main() {
  const manifestPath = process.argv[2] || "eval/samples/scale.manifest.json";
  const cases: ScaleEvalCase[] = JSON.parse(await readFile(manifestPath, "utf8"));
  if (cases.length === 0) {
    console.log(`No cases in ${manifestPath}. Populate it (see eval/samples/scale.manifest.example.json).`);
    return;
  }

  const rows: ScaleEvalRow[] = [];
  for (const c of cases) rows.push(await runScaleCase(c));

  let ratioP = 0, palP = 0, det = 0, pass = 0;
  const n = rows.length;
  console.log("\n=== SCALE EVAL ===");
  console.log("id | est | measFrac | ratioErr | paletteΔE | poseBgΔE | verdict | det | artifact");
  for (const r of rows) {
    if (r.error) { console.log(`${r.id} | ERROR | ${r.error}`); continue; }
    const m = r.metrics!, v = r.verdict!;
    if (v.ratioPass) ratioP++;
    if (v.palettePass) palP++;
    if (r.deterministic) det++;
    if (v.pass) pass++;
    console.log([
      r.id,
      m.estimator,
      m.measuredFraction.toFixed(3),
      m.scaleRatioError.toFixed(3),
      m.paletteDeltaE.toFixed(2),
      m.poseBgDeltaE.toFixed(2),
      v.pass ? "PASS" : "FAIL",
      r.deterministic ? "det" : "NONDET",
      r.artifact ? path.relative(process.cwd(), r.artifact) : "-",
    ].join(" | "));
  }
  console.log("\n--- aggregate (verdict = ratioPass && palettePass; poseBg is the D1/mask signal, EXCLUDED) ---");
  console.log(`scaleRatioError<=.15 : ${ratioP}/${n}`);
  console.log(`paletteΔE<=5         : ${palP}/${n}`);
  console.log(`deterministic        : ${det}/${n}`);
  console.log(`PASS                 : ${pass}/${n}`);
  console.log("\nNOTE: poseBgDeltaE (background motion on a loose raster) is reported, not in pass. PNGs are primary.");
}

// Run main() only when invoked directly (not when imported by a test).
if (process.argv[1] && path.basename(process.argv[1]).includes("scaleEval")) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
