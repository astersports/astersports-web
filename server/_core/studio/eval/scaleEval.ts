/**
 * PHASE B-EVAL — deterministic scale eval harness (offline; no UI, no router).
 *
 * Run:  npx tsx server/_core/studio/eval/scaleEval.ts [path/to/manifest.json]
 * Needs SAM2 creds (the fabric mask uses the SAM2 provider) OR a manual bbox +
 * raster for offline mode. Pre-launch: no customer data.
 *
 * The op ALWAYS runs with a RASTER (SAM2 or manual) — production behavior requires
 * rasterReady. The metric scores against a TRUTH fabric mask (`truthMaskUrl`) so
 * the background-bleed (poseBgDeltaE) signal is real. Without a truth mask, poseBg
 * is scored against the op's own raster membership (structurally ~0 since the op
 * composites only inside the raster) and is reported as "blind".
 *
 * Produces a per-case table, aggregate pass rates, a RASTER-QUALITY list (cases
 * where op passes but poseBg fails — the D1 mask-quality signal), a determinism
 * check, and a side-by-side before/after PNG.
 */
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { getMaskProvider, type FabricMask } from "../../masking";
import { decodeUpright } from "../../image/decodeUpright";
import { scalePrintRepeat } from "../ops/scaleRepeat";
import { fabricMembership } from "../ops/membership";
import { computeScaleMetrics, scaleVerdict, type ScaleMetrics } from "./scaleMetrics";

interface ScaleEvalCase {
  id: string;
  imageUrl: string;
  /** Linear scale fraction: 0.5 = shrink 50%, 1.3 = enlarge 30%. */
  targetFraction: number;
  note?: string;
  /**
   * Optional manual fabric bbox (normalized 0..1). When present AND rasterUrl is
   * also provided, the harness skips the SAM2 provider and runs fully OFFLINE.
   * Without rasterUrl, bbox alone is insufficient (the op requires a raster).
   */
  bbox?: { x: number; y: number; w: number; h: number };
  /**
   * Path/URL to a binary raster mask (white=fabric, black=background). Required
   * for offline mode (with bbox). Dims must match the image exactly.
   */
  rasterUrl?: string;
  /**
   * Path/URL to a TRUTH fabric mask (SAM2 eval ground truth): non-near-black =
   * fabric. The metric classifies background against THIS, decoupled from the
   * op's raster membership. Without it, poseBg is blind.
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

/** Load a raster mask image into a RasterMask-compatible Uint8Array (>127 = 255). */
async function loadRasterMask(url: string, width: number, height: number): Promise<Uint8Array> {
  const img = await decodeUpright(url);
  if (img.width !== width || img.height !== height) {
    throw new Error(
      `raster mask dims ${img.width}x${img.height} != image ${width}x${height} for ${url}`
    );
  }
  const data = new Uint8Array(width * height);
  for (let i = 0; i < data.length; i++) {
    const p = i * 4;
    data[i] = Math.max(img.buffer[p], img.buffer[p + 1], img.buffer[p + 2]) > 127 ? 255 : 0;
  }
  return data;
}

async function saveSideBySide(srcRGBA: Buffer, w: number, h: number, outRGBA: Buffer, id: string) {
  await mkdir(OUT_DIR, { recursive: true });
  const srcPng = await sharp(srcRGBA, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
  const outPng = await sharp(outRGBA, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
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
  const file = path.join(OUT_DIR, `scale-${id}.png`);
  await writeFile(file, composite);
  return file;
}

async function main() {
  const manifestPath = process.argv[2] || "eval/samples/scale.manifest.json";
  const cases: ScaleEvalCase[] = JSON.parse(await readFile(manifestPath, "utf8"));
  if (cases.length === 0) {
    console.log(`No cases in ${manifestPath}. Populate it (see eval/samples/README.md).`);
    return;
  }

  const provider = getMaskProvider();
  const rows: string[] = [];
  const rasterQuality: string[] = [];
  let ratioPass = 0, palPass = 0, poseBgPass = 0, det = 0;
  let truthCount = 0;

  for (const c of cases) {
    try {
      const { buffer: src, width, height } = await decodeUpright(c.imageUrl);

      // Resolve the fabric mask (raster required for the op).
      let fabric: FabricMask;
      if (c.bbox && c.rasterUrl) {
        // Offline mode: manual bbox + raster.
        const rasterData = await loadRasterMask(c.rasterUrl, width, height);
        fabric = {
          bbox: c.bbox,
          confidence: 1,
          provider: "sam2",
          raster: { width, height, data: rasterData },
        };
      } else if (c.bbox) {
        // bbox-only: cannot run (op requires raster). Try provider.
        console.warn(`[scale-eval] Case ${c.id}: bbox without rasterUrl — calling provider for raster.`);
        fabric = await provider.getFabricMask({ url: c.imageUrl });
        if (!fabric.raster) {
          throw new Error("Provider returned no raster; scale requires rasterReady. Add rasterUrl for offline.");
        }
      } else {
        // Auto mode: use the mask provider (needs SAM2 creds).
        fabric = await provider.getFabricMask({ url: c.imageUrl });
        if (!fabric.raster) {
          throw new Error("Provider returned no raster; scale requires rasterReady.");
        }
      }

      // Run the op.
      const result = await scalePrintRepeat({
        image: { url: c.imageUrl },
        fabric,
        targetFraction: c.targetFraction,
      });

      // Truth mask for metric scoring.
      const truthAvailable = !!c.truthMaskUrl;
      const truthMask = truthAvailable
        ? await loadTruthMask(c.truthMaskUrl!, width, height)
        : fabricMembership(fabric, width, height);

      // Compute metrics.
      const m: ScaleMetrics = computeScaleMetrics({
        source: src,
        out: result.data,
        width,
        height,
        truthMask,
        targetFraction: c.targetFraction,
      });
      const v = scaleVerdict(m);

      // Determinism: identical bytes on re-run.
      const result2 = await scalePrintRepeat({
        image: { url: c.imageUrl },
        fabric,
        targetFraction: c.targetFraction,
      });
      const deterministic = Buffer.compare(result.data, result2.data) === 0;

      const file = await saveSideBySide(src, width, height, result.data, c.id);

      if (v.ratioPass) ratioPass++;
      if (v.palettePass) palPass++;
      if (v.poseBgPass) poseBgPass++;
      if (deterministic) det++;

      // Raster-quality signal: op passes but poseBg fails (only meaningful with truth).
      if (truthAvailable) {
        truthCount++;
        if (v.pass && !v.poseBgPass) rasterQuality.push(c.id);
      }

      rows.push(
        [
          c.id,
          c.targetFraction.toFixed(2),
          m.measuredFraction.toFixed(3),
          m.scaleRatioError.toFixed(3),
          m.estimator,
          m.periodConfidence.toFixed(2),
          m.paletteDeltaE.toFixed(2),
          truthAvailable ? m.poseBgDeltaE.toFixed(2) : "blind",
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
  console.log("\n=== B-EVAL: deterministic scale (scaleRepeat) ===");
  console.log("id | target | measured | ratioErr | estimator | periodConf | paletteΔE | poseBgΔE | verdict | det | truth | artifact");
  console.log(rows.join("\n"));
  console.log("\n--- aggregate (verdict = op correctness: ratioError && paletteDeltaE; poseBg is the D1/mask signal) ---");
  console.log(`ratio err ≤0.15 : ${ratioPass}/${n}`);
  console.log(`palette ΔE≤5    : ${palPass}/${n}`);
  console.log(`poseBg ΔE≤2     : ${poseBgPass}/${truthCount > 0 ? truthCount : n}  (background bleed — meaningful only with truth mask)`);
  console.log(`deterministic   : ${det}/${n}`);
  console.log("\n--- RASTER-QUALITY (truth-masked cases that PASS op but FAIL poseBg) — the D1 mask-quality signal ---");
  console.log(
    truthCount === 0
      ? "(no truth masks supplied — poseBg is BLIND; add truthMaskUrl per case to measure the D1 signal)"
      : rasterQuality.length ? rasterQuality.join(", ") : "(none — background bleed under threshold on truth-masked cases)"
  );
  console.log("\nNOTE: op requires rasterReady (SAM2 or manual rasterUrl). The metric scores against the truth mask.");
  console.log("Without truthMaskUrl, poseBg is structurally blind. The PNGs remain primary for interpretation.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
