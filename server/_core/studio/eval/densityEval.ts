/**
 * PHASE C-EVAL — deterministic density eval harness (offline; no UI, no router).
 *
 * Run:  npx tsx server/_core/studio/eval/densityEval.ts [path/to/manifest.json]
 * Needs SAM2 creds (the fabric + instance masks use the SAM2 provider) OR manual
 * raster + instance labels for offline mode. Pre-launch: no customer data.
 *
 * The op ALWAYS runs with a RASTER + INSTANCES (SAM2 or manual) — production
 * behavior requires rasterReady. The metric scores against TRUTH instance labels
 * (`truthInstanceLabelsUrl`) and a TRUTH fabric mask (`truthMaskUrl`) so count
 * accuracy and background-bleed are real signals.
 *
 * Truth instance labels format: a raw Int32 file (little-endian, width*height
 * entries) where -1 = ground/non-motif and >=0 = motif instance id. Alternatively,
 * a PNG where each unique non-black color maps to one instance.
 *
 * Produces a per-case table, aggregate pass rates, a RASTER-QUALITY list (cases
 * where op passes but bgDeltaE fails), a determinism check, and a side-by-side
 * before/after PNG.
 */
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { getMaskProvider, type FabricMask, type InstanceMask } from "../../masking";
import { decodeUpright } from "../../image/decodeUpright";
import { densityThin } from "../ops/densityThin";
import { fabricMembership } from "../ops/membership";
import { computeDensityMetrics, densityVerdict, type DensityMetrics } from "./densityMetrics";

interface DensityEvalCase {
  id: string;
  imageUrl: string;
  /** Percent of motif instances to remove (0..90). */
  percent: number;
  note?: string;
  /**
   * Optional manual fabric bbox (normalized 0..1). When present AND rasterUrl +
   * instanceLabelsUrl are also provided, the harness runs fully OFFLINE.
   */
  bbox?: { x: number; y: number; w: number; h: number };
  /**
   * Path/URL to a binary raster mask (white=fabric, black=background). Required
   * for offline mode (with bbox). Dims must match the image exactly.
   */
  rasterUrl?: string;
  /**
   * Path/URL to a truth instance label PNG. Each unique non-black color = one
   * instance. Dims must match the image exactly. Used both as op input (converted
   * to InstanceMask[]) and as metric truth.
   */
  instanceLabelsUrl?: string;
  /**
   * Path/URL to a TRUTH fabric mask (SAM2 eval ground truth): non-near-black =
   * fabric. The metric classifies background against THIS. Without it, bgDeltaE
   * is scored against the op's own raster membership (blind).
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

/**
 * Load a truth instance label PNG. Each unique non-black color maps to one
 * instance. Returns { labels: Int32Array, instances: InstanceMask[] }.
 * labels[i] = -1 for ground, >=0 for motif instance id.
 */
async function loadInstanceLabels(
  url: string,
  width: number,
  height: number
): Promise<{ labels: Int32Array; instances: InstanceMask[] }> {
  const img = await decodeUpright(url);
  if (img.width !== width || img.height !== height) {
    throw new Error(
      `instance labels dims ${img.width}x${img.height} != image ${width}x${height} for ${url}`
    );
  }

  // Map each unique non-black color to an instance id.
  const colorToId = new Map<number, number>();
  const labels = new Int32Array(width * height);
  labels.fill(-1);
  let nextId = 0;

  for (let i = 0; i < width * height; i++) {
    const p = i * 4;
    const r = img.buffer[p], g = img.buffer[p + 1], b = img.buffer[p + 2];
    // Black = ground.
    if (r < 10 && g < 10 && b < 10) continue;
    const key = (r << 16) | (g << 8) | b;
    let id = colorToId.get(key);
    if (id === undefined) {
      id = nextId++;
      colorToId.set(key, id);
    }
    labels[i] = id;
  }

  // Build InstanceMask[] from the label map (bbox + raster per instance).
  const instanceBounds = new Map<number, { x0: number; y0: number; x1: number; y1: number }>();
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const id = labels[y * width + x];
      if (id < 0) continue;
      let b = instanceBounds.get(id);
      if (!b) {
        b = { x0: x, y0: y, x1: x, y1: y };
        instanceBounds.set(id, b);
      } else {
        if (x < b.x0) b.x0 = x;
        if (x > b.x1) b.x1 = x;
        if (y < b.y0) b.y0 = y;
        if (y > b.y1) b.y1 = y;
      }
    }
  }

  const instances: InstanceMask[] = [];
  for (const [id, b] of Array.from(instanceBounds.entries())) {
    // Build a full-image raster for this instance.
    const rasterData = new Uint8Array(width * height);
    for (let i = 0; i < labels.length; i++) {
      if (labels[i] === id) rasterData[i] = 255;
    }
    instances.push({
      bbox: {
        x: b.x0 / width,
        y: b.y0 / height,
        w: (b.x1 - b.x0 + 1) / width,
        h: (b.y1 - b.y0 + 1) / height,
      },
      raster: { width, height, data: rasterData },
    });
  }

  return { labels, instances };
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
  const file = path.join(OUT_DIR, `density-${id}.png`);
  await writeFile(file, composite);
  return file;
}

async function main() {
  const manifestPath = process.argv[2] || "eval/samples/density.manifest.json";
  const cases: DensityEvalCase[] = JSON.parse(await readFile(manifestPath, "utf8"));
  if (cases.length === 0) {
    console.log(`No cases in ${manifestPath}. Populate it (see eval/samples/README.md).`);
    return;
  }

  const provider = getMaskProvider();
  const rows: string[] = [];
  const rasterQuality: string[] = [];
  let countPass = 0, survPass = 0, evenPass = 0, infillPass = 0, bgPass = 0, det = 0;
  let truthCount = 0;

  for (const c of cases) {
    try {
      const { buffer: src, width, height } = await decodeUpright(c.imageUrl);

      // Resolve the fabric mask + instances.
      let fabric: FabricMask;
      let instances: InstanceMask[];
      let truthLabels: Int32Array;

      if (c.bbox && c.rasterUrl && c.instanceLabelsUrl) {
        // Fully offline mode.
        const rasterData = await loadRasterMask(c.rasterUrl, width, height);
        fabric = {
          bbox: c.bbox,
          confidence: 1,
          provider: "sam2",
          raster: { width, height, data: rasterData },
        };
        const loaded = await loadInstanceLabels(c.instanceLabelsUrl, width, height);
        instances = loaded.instances;
        truthLabels = loaded.labels;
      } else {
        // Auto mode: use the mask provider (needs SAM2 creds).
        fabric = await provider.getFabricMask({ url: c.imageUrl });
        if (!fabric.raster) {
          throw new Error("Provider returned no raster; density requires rasterReady.");
        }
        const provInstances = await provider.getInstanceMasks({ url: c.imageUrl }, fabric);
        instances = provInstances;

        // Build truth labels from provider instances (best-effort; truth mask is the
        // provider's own output — not independent ground truth, but exercises the full path).
        truthLabels = new Int32Array(width * height);
        truthLabels.fill(-1);
        for (let idx = 0; idx < instances.length; idx++) {
          const inst = instances[idx];
          if (inst.raster && inst.raster.width === width && inst.raster.height === height) {
            for (let i = 0; i < width * height; i++) {
              if (inst.raster.data[i] > 127) truthLabels[i] = idx;
            }
          } else {
            // Fallback: fill bbox.
            const x0 = Math.floor(inst.bbox.x * width), y0 = Math.floor(inst.bbox.y * height);
            const x1 = Math.ceil((inst.bbox.x + inst.bbox.w) * width);
            const y1 = Math.ceil((inst.bbox.y + inst.bbox.h) * height);
            for (let y = Math.max(0, y0); y < Math.min(height, y1); y++) {
              for (let x = Math.max(0, x0); x < Math.min(width, x1); x++) {
                truthLabels[y * width + x] = idx;
              }
            }
          }
        }
      }

      // Run the op.
      const result = await densityThin({
        image: { url: c.imageUrl },
        fabric,
        instances,
        percent: c.percent,
      });

      // Truth mask for metric scoring.
      const truthMaskAvailable = !!c.truthMaskUrl;
      const truthMask = truthMaskAvailable
        ? await loadTruthMask(c.truthMaskUrl!, width, height)
        : fabricMembership(fabric, width, height);

      // Compute metrics.
      const m: DensityMetrics = computeDensityMetrics({
        source: src,
        out: result.data,
        width,
        height,
        truthMask,
        truthInstanceLabels: truthLabels,
        targetRemovalFraction: c.percent / 100,
      });
      const v = densityVerdict(m);

      // Determinism: identical bytes on re-run.
      const result2 = await densityThin({
        image: { url: c.imageUrl },
        fabric,
        instances,
        percent: c.percent,
      });
      const deterministic = Buffer.compare(result.data, result2.data) === 0;

      const file = await saveSideBySide(src, width, height, result.data, c.id);

      if (v.countPass) countPass++;
      if (v.survivorPass) survPass++;
      if (v.evennessPass) evenPass++;
      if (v.infillPass) infillPass++;
      if (v.bgPass) bgPass++;
      if (deterministic) det++;

      // Raster-quality signal: op passes but bgDeltaE fails (only meaningful with truth).
      if (truthMaskAvailable) {
        truthCount++;
        if (v.pass && !v.bgPass) rasterQuality.push(c.id);
      }

      rows.push(
        [
          c.id,
          String(c.percent) + "%",
          `${m.removedInstances}/${m.totalInstances}`,
          m.countError.toFixed(3),
          m.survivorIntegrity.toFixed(2),
          m.evenness.toFixed(2),
          m.infillCleanliness.toFixed(2),
          truthMaskAvailable ? m.bgDeltaE.toFixed(2) : "blind",
          v.pass ? "PASS" : "FAIL",
          deterministic ? "det" : "NONDET",
          truthMaskAvailable ? "truth:SAM2" : "truth:none",
          path.relative(process.cwd(), file),
        ].join(" | ")
      );
    } catch (err: any) {
      rows.push(`${c.id} | ERROR | ${err?.message || err}`);
    }
  }

  const n = cases.length;
  console.log("\n=== C-EVAL: deterministic density (densityThin) ===");
  console.log("id | percent | removed/total | countErr | survivorΔE | evenness | infillClean | bgΔE | verdict | det | truth | artifact");
  console.log(rows.join("\n"));
  console.log("\n--- aggregate (verdict = op correctness: count && survivor && evenness && infill; bgDeltaE is the D1/mask signal) ---");
  console.log(`count err ≤0.10     : ${countPass}/${n}`);
  console.log(`survivor ΔE≤2      : ${survPass}/${n}`);
  console.log(`evenness ≤1.5      : ${evenPass}/${n}`);
  console.log(`infill clean ≤2.5  : ${infillPass}/${n}`);
  console.log(`bg ΔE≤2            : ${bgPass}/${truthCount > 0 ? truthCount : n}  (background bleed — meaningful only with truth mask)`);
  console.log(`deterministic      : ${det}/${n}`);
  console.log("\n--- RASTER-QUALITY (truth-masked cases that PASS op but FAIL bgDeltaE) — the D1 mask-quality signal ---");
  console.log(
    truthCount === 0
      ? "(no truth masks supplied — bgDeltaE is BLIND; add truthMaskUrl per case to measure the D1 signal)"
      : rasterQuality.length ? rasterQuality.join(", ") : "(none — background bleed under threshold on truth-masked cases)"
  );
  console.log("\nNOTE: op requires rasterReady + instances (SAM2 or manual instanceLabelsUrl). The metric scores against truth labels.");
  console.log("Without truthMaskUrl, bgDeltaE is structurally blind. The PNGs remain primary for interpretation.");
  console.log("Instance label format: PNG where each unique non-black color = one motif instance.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
