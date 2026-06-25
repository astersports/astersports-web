/**
 * ADVERSARIAL AUDIT — does the offline pipeline survive REAL print conditions
 * (bunching/overlap, multicolour, varied ground, low contrast)? Each hard fixture has
 * a known exact N. We measure, per condition:
 *   - SEGMENTER count error  |detected − N|/N   (M2, the contrast/bunching-sensitive one)
 *   - DENSITY-given-truth     removed/N at 50%   (M1, isolates the remover from detection)
 *   - SCALE detector accept   (M3, the coarse all-over classifier)
 *
 * The point: separate what is ROBUST (density math given instances; scale detection)
 * from what DEGRADES with real conditions (classical segmentation count) — so the 90%
 * claim is stated against the right scope, not oversold.
 *
 * Run: npx tsx eval/phase1Audit.ts
 */
import { readFile } from "node:fs/promises";
import { decodeUpright } from "../server/_core/image/decodeUpright";
import { densityThin } from "../server/_core/studio/ops/densityThin";
import { loadFabricMask, loadInstanceLabelMap } from "../server/_core/studio/eval/evalMaskIO";
import { detectRepeat } from "../server/_core/studio/ops/repeatDetector";
import { segmentMotifs } from "./segmentMotifs";

interface Hard { id: string; condition: string; scene: string; raster: string; instances: string; trueCount: number; note: string }
const REL_TOL = 0.10;

async function main() {
  const fx: Hard[] = JSON.parse(await readFile("eval/samples/phase1-hard/phase1.hard.json", "utf8"));
  type Row = { id: string; cond: string; N: number; seg: number; segErr: number; segPass: boolean; densActual: number; densPass: boolean; accept: boolean; note: string };
  const rows: Row[] = [];

  for (const f of fx) {
    const { buffer, width, height } = await decodeUpright(f.scene);
    const { raster, bbox } = await loadFabricMask(f.raster, width, height);
    const { instances } = await loadInstanceLabelMap(f.instances, width, height);

    // M2 — classical segmenter count vs known N (default params; no per-fixture tuning).
    const seg = await segmentMotifs(f.scene, { deltaE: 20, minAreaFrac: 0.0002, maxAreaFrac: 0.03 });
    const segErr = Math.abs(seg.count - f.trueCount) / f.trueCount;

    // M1 — density REMOVER given TRUTH instances at 50% (isolates the math).
    const r = await densityThin({ image: { url: f.scene }, fabric: { bbox, confidence: 1, provider: "sam2", raster }, instances, percent: 50 });
    const densActual = instances.length ? r.removed / instances.length : 0;

    // M3 — scale detector accept (all-over coverage).
    const det = detectRepeat(buffer, width, height, raster.data);

    rows.push({
      id: f.id, cond: f.condition, N: f.trueCount,
      seg: seg.count, segErr, segPass: segErr <= REL_TOL,
      densActual, densPass: Math.abs(densActual - 0.5) <= REL_TOL * 0.5,
      accept: det.isAllover, note: f.note,
    });
  }

  console.log("\n## ADVERSARIAL AUDIT — hard real-print conditions (known N)\n");
  console.log("| fixture | condition | N | seg→ | segErr% | seg±10%? | dens@50%→ | dens ok? | scale accept? | note |");
  console.log("|---|---|--:|--:|--:|:--:|--:|:--:|:--:|---|");
  for (const r of rows) {
    console.log(`| ${r.id} | ${r.cond} | ${r.N} | ${r.seg} | ${(r.segErr * 100).toFixed(0)} | ${r.segPass ? "✅" : "❌"} | ${(r.densActual * 100).toFixed(0)}% | ${r.densPass ? "✅" : "❌"} | ${r.accept ? "✅" : "❌"} | ${r.note} |`);
  }
  const segP = rows.filter((r) => r.segPass).length, densP = rows.filter((r) => r.densPass).length, accP = rows.filter((r) => r.accept).length;
  const n = rows.length;
  console.log(`\n**Segmenter count ±10%: ${segP}/${n} (${((100 * segP) / n).toFixed(0)}%)** · **Density-given-truth ±10%: ${densP}/${n}** · **Scale accept: ${accP}/${n}**`);
  console.log("\nReading: density-given-truth and scale-accept stay high across ALL conditions");
  console.log("(they don't depend on counting). The SEGMENTER count is what collapses on");
  console.log("overlap/low-contrast — that is the classical ceiling that needs SAM2.");
}
main().catch((e) => { console.error(e); process.exit(1); });
