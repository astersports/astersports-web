/**
 * PHASE A1-EVAL — deterministic recolor eval harness (offline; no UI, no router).
 *
 * Run:  npx tsx server/_core/studio/eval/recolorEval.ts [path/to/manifest.json]
 * Needs Forge creds (the fabric mask uses the vision LLM) and Frank's own sample
 * garments in the manifest. Pre-launch: no customer data.
 *
 * The op always runs at the FLOOR (bbox) — production behavior. The metric scores
 * against a TRUTH fabric mask (`truthMaskUrl`, a SAM2-generated mask) so the
 * background-bleed (D1/raster) signal is real and not structurally 0. Without a
 * truth mask, offBg is BLIND (the op never touches background, so it reads 0) and
 * is reported as such — never as evidence.
 *
 * Produces a per-case table, aggregate pass rates, a RASTER-NEEDED list (the only
 * D1 raster signal), a determinism check, and a side-by-side before/after PNG.
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
  /**
   * Path/URL to a TRUTH fabric mask (SAM2 eval ground truth): non-near-black =
   * fabric. The metric classifies background against THIS, decoupled from the
   * op's floor (bbox) membership. Without it, the background-bleed metric is blind.
   */
  truthMaskUrl?: string;
}

const OUT_DIR = path.resolve("eval/out");

/** Load a mask image into a membership array (fabric where max(r,g,b) > 127). */
async function loadTruthMask(url: string, width: number, height: number): Promise<Uint8Array> {
  const img = await decodeUpright(url);
  if (img.width !== width || img.height !== height) {
    throw new Error(
      `truth mask dims ${img.width}x${img.height} != image ${width}x${height} for ${url}`
    );
  }
  const m = new Uint8Array(width * height);
  for (let i = 0; i < m.length; i++) {
    const p = i * 4;
    m[i] = Math.max(img.buffer[p], img.buffer[p + 1], img.buffer[p + 2]) > 127 ? 1 : 0;
  }
  return m;
}

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
  const opTuning: string[] = [];
  let tPass = 0, lPass = 0, oFabPass = 0, det = 0;
  let truthCount = 0, oBgPassTruth = 0;

  for (const c of cases) {
    try {
      // Op ALWAYS runs at the floor (bbox or vision mask) — production behavior.
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

      // Metric classifies against a TRUTH mask (SAM2) when provided; else falls
      // back to the op's bbox membership — in which case offBg is BLIND (the op
      // never touches background, so it reads 0) and is not counted as evidence.
      const truthAvailable = !!c.truthMaskUrl;
      const truthMask = truthAvailable
        ? await loadTruthMask(c.truthMaskUrl!, width, height)
        : fabricMembership(fabric, width, height);

      const m = computeRecolorMetrics(src, out.data, width, height, truthMask, c.fromColor, c.toColor);
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
      if (v.offFabricPass) oFabPass++;
      if (deterministic) det++;
      // Nearby-separation pull is op-tuning (always measurable).
      if (v.targetPass && v.lumPass && !v.offFabricPass) opTuning.push(c.id);
      // Background bleed (raster) is only meaningful against a truth mask.
      if (truthAvailable) {
        truthCount++;
        if (v.offBackgroundPass) oBgPassTruth++;
        if (v.targetPass && v.lumPass && !v.offBackgroundPass) rasterNeeded.push(c.id);
      }

      rows.push(
        [
          c.id,
          c.fromColor,
          c.toColor,
          String(c.coverage),
          m.targetDeltaE.toFixed(2),
          m.lumSSIM.toFixed(3),
          truthAvailable ? m.offTargetBackgroundDeltaE.toFixed(2) : "blind",
          m.offTargetFabricDeltaE.toFixed(2),
          v.pass ? "PASS" : "FAIL",
          deterministic ? "det" : "NONDET",
          truthAvailable ? "truth:SAM2" : "truth:none",
          path.relative(process.cwd(), file),
        ].join(" | ")
      );
    } catch (err: any) {
      rows.push(`${c.id} | ERROR | ${err?.message || err}`);
    }
  }

  const n = cases.length;
  console.log("\n=== A1-EVAL: deterministic recolor ===");
  console.log("id | from | to | cov | targetΔE | lumSSIM | offBgΔE | offFabΔE | verdict | det | truth | artifact");
  console.log(rows.join("\n"));
  console.log("\n--- aggregate (verdict = op correctness: target && lum && offFab; offBg is the D1/mask signal) ---");
  console.log(`target ΔE<=5    : ${tPass}/${n}`);
  console.log(`lum SSIM>=.95   : ${lPass}/${n}`);
  console.log(`offFab ΔE<=2     : ${oFabPass}/${n}  (nearby-separation pull — op-tuning)`);
  console.log(`offBg  ΔE<=2     : ${oBgPassTruth}/${truthCount}  (background bleed — only on cases WITH a SAM2 truth mask)`);
  console.log(`deterministic   : ${det}/${n}`);
  console.log("\n--- RASTER-NEEDED (truth-masked cases that pass target+lum, FAIL background bleed) — the D1 raster signal ---");
  console.log(
    truthCount === 0
      ? "(no truth masks supplied — offBg is BLIND; add truthMaskUrl per case to measure the D1 signal)"
      : rasterNeeded.length ? rasterNeeded.join(", ") : "(none — background bleed under threshold on truth-masked cases)"
  );
  console.log("\n--- OP-TUNING: reduce radius at high coverage (pass target+lum, FAIL fabric bleed) — NOT a mask problem ---");
  console.log(opTuning.length ? opTuning.join(", ") : "(none — no nearby-separation pull on this set)");
  console.log("\nNOTE: op runs at the floor (bbox); the metric scores against the SAM2 truth mask.");
  console.log("Without truthMaskUrl, offBg is structurally blind. The PNGs remain primary for interpretation.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
