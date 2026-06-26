/**
 * Probe: how much does the "even re-space" (densityRedistribute v2) output change
 * between adjacent density percentages? Runs the REAL op on the deterministic
 * 36-dot synthetic at several percents and reports survivor count + mean
 * nearest-neighbour spacing of the relocated motifs.
 *
 * Run: cd /home/user/astersports-web && npx tsx scripts/density-respace-step-probe.ts
 */
import { decodeUpright } from "../server/_core/image/decodeUpright";
import { densityRedistribute } from "../server/_core/studio/ops/densityRedistribute";
import { loadFabricMask, loadInstanceLabelMap, EVAL_OUT_DIR } from "../server/_core/studio/eval/evalMaskIO";
import { ensureRedistributeFixture } from "../server/_core/studio/eval/genRedistributeFixture";
import type { FabricMask, Point } from "../server/_core/masking/types";

function meanNNSpacing(pts: Point[]): number {
  if (pts.length < 2) return 0;
  let sum = 0;
  for (let i = 0; i < pts.length; i++) {
    let best = Infinity;
    for (let j = 0; j < pts.length; j++) {
      if (i === j) continue;
      const d = (pts[i][0] - pts[j][0]) ** 2 + (pts[i][1] - pts[j][1]) ** 2;
      if (d < best) best = d;
    }
    sum += Math.sqrt(best);
  }
  return sum / pts.length;
}

async function main() {
  const fx = await ensureRedistributeFixture(EVAL_OUT_DIR);
  const { width, height } = await decodeUpright(fx.scene);
  const { raster, bbox } = await loadFabricMask(fx.mask, width, height);
  const { instances } = await loadInstanceLabelMap(fx.labels, width, height);
  const fabric: FabricMask = { bbox, confidence: 1, raster, boundaryRaster: raster, provider: "sam2" };

  console.log(`synthetic: ${instances.length} instances on a ${width}x${height} full-fabric raster\n`);
  console.log("percent | kept | removed | coverageΔ(rel) | meanNNspacing(px)");

  let prevSpacing = 0;
  for (const percent of [0, 10, 20, 30, 40, 50, 60, 70]) {
    const r = await densityRedistribute({ image: { url: fx.scene }, fabric, instances, percent });
    const spacing = meanNNSpacing(r.targets.length ? r.targets : []);
    const coverageRel = r.kept / instances.length; // motif-area coverage relative to original
    const stepVsPrev = prevSpacing ? ((spacing - prevSpacing) / prevSpacing) * 100 : 0;
    console.log(
      `${String(percent).padStart(6)}% | ${String(r.kept).padStart(4)} | ${String(r.removed).padStart(7)} | ` +
      `${coverageRel.toFixed(2).padStart(13)} | ${spacing.toFixed(1).padStart(8)}` +
      (prevSpacing ? `  (+${stepVsPrev.toFixed(1)}% vs prev)` : "")
    );
    prevSpacing = spacing;
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
