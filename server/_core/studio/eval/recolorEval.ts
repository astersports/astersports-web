/**
 * PHASE A1-EVAL — deterministic recolor eval harness (offline; no UI, no router).
 *
 * Run:  npx tsx server/_core/studio/eval/recolorEval.ts [path/to/manifest.json]
 * Needs Forge creds (the fabric mask uses the vision LLM) and Frank's own sample
 * garments in the manifest. Pre-launch: no customer data.
 *
 * Produces a per-case table, aggregate pass rates, a RASTER-NEEDED list (cases
 * that pass target+lum but FAIL off-target on bbox-only — the D1 recolor signal),
 * a determinism check, and a side-by-side before/after PNG per case.
 */
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { getMaskProvider, type FabricMask } from "../../masking";
import { decodeUpright } from "../../image/decodeUpright";
import { separationRemap } from "../ops/separationRemap";
import { fabricMembership } from "../ops/membership";
import { computeRecolorMetrics, verdict } from "./metrics";

interface EvalCase {
  id: string;
  imageUrl: string;
  fromColor: string;
  toColor: string;
  coverage: number;
  note?: string;
  /**
   * Optional manual fabric bbox (normalized 0..1). When present the harness skips
   * the vision-LLM fabric mask, so a case runs fully OFFLINE (no Forge) — useful
   * for local sample images.
   */
  bbox?: { x: number; y: number; w: number; h: number };
}

const OUT_DIR = path.resolve("eval/out");

async function rawRGBA(png: Buffer): Promise<{ data: Buffer; width: number; height: number }> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

async function saveSideBySide(srcRGBA: Buffer, w: number, h: number, outPng: Buffer, id: string) {
  await mkdir(OUT_DIR, { recursive: true });
  const srcPng = await sharp(srcRGBA, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
  const canvas = sharp({
    create: { width: w * 2 + 8, height: h, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } },
  });
  const composite = await canvas
    .composite([
      { input: srcPng, left: 0, top: 0 },
      { input: outPng, left: w + 8, top: 0 },
    ])
    .png()
    .toBuffer();
  const file = path.join(OUT_DIR, `${id}.png`);
  await writeFile(file, composite);
  return file;
}

async function main() {
  const manifestPath = process.argv[2] || "eval/samples/recolor.manifest.json";
  const cases: EvalCase[] = JSON.parse(await readFile(manifestPath, "utf8"));
  if (cases.length === 0) {
    console.log(`No cases in ${manifestPath}. Populate it (see eval/samples/README.md).`);
    return;
  }

  const provider = getMaskProvider();
  const rows: string[] = [];
  const rasterNeeded: string[] = [];
  let tPass = 0, lPass = 0, oPass = 0, det = 0;

  for (const c of cases) {
    try {
      // Manual bbox => fully offline (no vision call); else use the mask provider.
      const fabric: FabricMask = c.bbox
        ? { bbox: c.bbox, confidence: 1, provider: "classical" }
        : await provider.getFabricMask({ url: c.imageUrl });
      const { buffer: src, width, height } = await decodeUpright(c.imageUrl);

      const outPng = await separationRemap(
        { url: c.imageUrl },
        fabric,
        { fromColor: c.fromColor, toColor: c.toColor, coverage: c.coverage }
      );
      const out = await rawRGBA(outPng);

      const membership = fabricMembership(fabric, width, height);
      const m = computeRecolorMetrics(src, out.data, width, height, membership, c.fromColor, c.toColor);
      const v = verdict(m);

      // Determinism: identical bytes on re-run.
      const outPng2 = await separationRemap(
        { url: c.imageUrl },
        fabric,
        { fromColor: c.fromColor, toColor: c.toColor, coverage: c.coverage }
      );
      const deterministic = Buffer.compare(outPng, outPng2) === 0;

      const file = await saveSideBySide(src, width, height, outPng, c.id);

      if (v.targetPass) tPass++;
      if (v.lumPass) lPass++;
      if (v.offPass) oPass++;
      if (deterministic) det++;
      if (v.targetPass && v.lumPass && !v.offPass) rasterNeeded.push(c.id);

      rows.push(
        [
          c.id,
          c.fromColor,
          c.toColor,
          String(c.coverage),
          m.targetDeltaE.toFixed(2),
          m.lumSSIM.toFixed(3),
          m.offTargetDeltaE.toFixed(2),
          v.pass ? "PASS" : "FAIL",
          deterministic ? "det" : "NONDET",
          `mask:${fabric.provider}${fabric.raster ? "+raster" : "(bbox)"}`,
          path.relative(process.cwd(), file),
        ].join(" | ")
      );
    } catch (err: any) {
      rows.push(`${c.id} | ERROR | ${err?.message || err}`);
    }
  }

  const n = cases.length;
  console.log("\n=== A1-EVAL: deterministic recolor ===");
  console.log("id | from | to | cov | targetΔE | lumSSIM | offΔE | verdict | det | mask | artifact");
  console.log(rows.join("\n"));
  console.log("\n--- aggregate ---");
  console.log(`target ΔE<=5 : ${tPass}/${n}`);
  console.log(`lum SSIM>=.95: ${lPass}/${n}`);
  console.log(`off ΔE<=2    : ${oPass}/${n}`);
  console.log(`deterministic: ${det}/${n}`);
  console.log("\n--- RASTER-NEEDED (pass target+lum, FAIL off on bbox-only) — D1 recolor signal ---");
  console.log(rasterNeeded.length ? rasterNeeded.join(", ") : "(none — bbox membership clears off-target on this set)");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
