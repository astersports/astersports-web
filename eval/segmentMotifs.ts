/**
 * EVAL-ONLY offline motif segmenter — NOT a production mask provider, NOT wired to
 * the router. It exists so the Phase-1 density preview can run end-to-end on a REAL
 * client garment WITHOUT credentialed SAM2 (no Replicate, no sub-processor): a
 * stand-in that produces an APPROXIMATE instance label-map for high-contrast
 * scattered prints (the strategy-doc §0 bucket A: polka dots, tossed florals on a
 * contrasting ground).
 *
 * Method (classical, deterministic): inside the fabric bbox, estimate the dominant
 * ground colour (k-means in Lab), call every pixel far enough from ground in Lab a
 * motif pixel, then connected-components those into instances (area-filtered to drop
 * specks and merged mega-blobs). Each component becomes one distinct colour in the
 * label-map PNG that evalMaskIO.loadInstanceLabelMap already understands.
 *
 * LIMITS (be honest — DENSITY_SCALE_STRATEGY.txt §5): this is a contrast+CC counter,
 * not segmentation. It under-counts motifs that touch/overlap (one CC = two flowers)
 * and over-counts a motif that breaks into pieces. It is good enough to DEMO the
 * preview and to sanity-check count behaviour; the real count accuracy gate (G3)
 * still requires SAM2 instance masks on the credentialed run. Anything it emits is
 * an APPROXIMATE truth, labelled as such.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { rgb255ToLab } from "../server/_core/studio/ops/color";
import { kmeans, type Vec3 } from "../server/_core/studio/ops/kmeans";
import type { BBoxNormalized } from "../server/_core/masking/types";

export interface SegmentOptions {
  /** Restrict to this normalized region (the garment fabric). Default whole image. */
  bbox?: BBoxNormalized;
  /** Longest side to work at (speed + stability). Default 700. */
  maxDim?: number;
  /** Lab distance (ΔE76) above which a pixel counts as motif (not ground). Default 22. */
  deltaE?: number;
  /** Drop components smaller than this fraction of the bbox area. Default 0.0004. */
  minAreaFrac?: number;
  /** Drop components larger than this fraction of the bbox area (merged blobs / panels). Default 0.08. */
  maxAreaFrac?: number;
  /** k for the ground k-means. Default 3 (dominant cluster = ground). */
  groundClusters?: number;
}

export interface SegmentResult {
  width: number;
  height: number;
  count: number;
  /** Per-instance pixel area + normalized bbox, largest first. */
  instances: { area: number; bbox: BBoxNormalized }[];
  /** Raw RGBA: ground = black, each motif a distinct colour (loadInstanceLabelMap-ready). */
  labelMap: Buffer;
  /** Raw RGBA: fabric region white, else black (loadFabricMask-ready). */
  fabricMask: Buffer;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Distinct, non-near-black colour per instance id (golden-angle hue, full S/V). */
function instanceColor(id: number): [number, number, number] {
  const h = (id * 137.508) % 360;
  const c = 1, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = 0.15; // m>0 keeps it off pure black
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [Math.round((r + m) * 230) + 25, Math.round((g + m) * 230) + 25, Math.round((b + m) * 230) + 25];
}

export async function segmentMotifs(imagePath: string, opts: SegmentOptions = {}): Promise<SegmentResult> {
  const maxDim = opts.maxDim ?? 700;
  const deltaE = opts.deltaE ?? 22;
  const minAreaFrac = opts.minAreaFrac ?? 0.0004;
  const maxAreaFrac = opts.maxAreaFrac ?? 0.08;
  const groundClusters = opts.groundClusters ?? 3;

  const buf = await readFile(imagePath);
  const meta = await sharp(buf).metadata();
  const ow = meta.width ?? 0, oh = meta.height ?? 0;
  const scale = Math.min(1, maxDim / Math.max(ow, oh));
  const W = Math.max(1, Math.round(ow * scale)), H = Math.max(1, Math.round(oh * scale));
  const { data } = await sharp(buf).resize(W, H, { fit: "fill" }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });

  const bb = opts.bbox ?? { x: 0, y: 0, w: 1, h: 1 };
  const x0 = clamp(Math.floor(bb.x * W), 0, W), y0 = clamp(Math.floor(bb.y * H), 0, H);
  const x1 = clamp(Math.ceil((bb.x + bb.w) * W), 0, W), y1 = clamp(Math.ceil((bb.y + bb.h) * H), 0, H);
  const bboxArea = Math.max(1, (x1 - x0) * (y1 - y0));

  // Ground = dominant Lab cluster inside the bbox.
  const pts: Vec3[] = [];
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = (y * W + x) * 4;
    if ((x + y) % 2 === 0) { const l = rgb255ToLab(data[i], data[i + 1], data[i + 2]); pts.push([l.l, l.a, l.b]); }
  }
  const { centroids, assignments } = kmeans(pts, Math.min(groundClusters, Math.max(1, pts.length)), { seed: 1 });
  const counts = new Array(centroids.length).fill(0);
  for (const a of assignments) counts[a]++;
  let gi = 0; for (let c = 1; c < counts.length; c++) if (counts[c] > counts[gi]) gi = c;
  const ground = centroids[gi];

  // Foreground = far-from-ground pixels inside the bbox.
  const fg = new Uint8Array(W * H);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = (y * W + x) * 4;
    const l = rgb255ToLab(data[i], data[i + 1], data[i + 2]);
    const d = Math.hypot(l.l - ground[0], l.a - ground[1], l.b - ground[2]);
    if (d > deltaE) fg[y * W + x] = 1;
  }

  // Connected components (8-connectivity), iterative flood fill.
  const labels = new Int32Array(W * H).fill(-1);
  const comps: { area: number; minx: number; miny: number; maxx: number; maxy: number; pixels: number[] }[] = [];
  const stack: number[] = [];
  for (let s = 0; s < W * H; s++) {
    if (!fg[s] || labels[s] !== -1) continue;
    const id = comps.length;
    labels[s] = id; stack.length = 0; stack.push(s);
    const comp = { area: 0, minx: W, miny: H, maxx: 0, maxy: 0, pixels: [] as number[] };
    while (stack.length) {
      const p = stack.pop()!; const px = p % W, py = (p / W) | 0;
      comp.area++; comp.pixels.push(p);
      if (px < comp.minx) comp.minx = px; if (px > comp.maxx) comp.maxx = px;
      if (py < comp.miny) comp.miny = py; if (py > comp.maxy) comp.maxy = py;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = px + dx, ny = py + dy;
        if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
        const q = ny * W + nx;
        if (fg[q] && labels[q] === -1) { labels[q] = id; stack.push(q); }
      }
    }
    comps.push(comp);
  }

  const minArea = Math.max(2, minAreaFrac * bboxArea), maxArea = maxAreaFrac * bboxArea;
  const kept = comps.filter((c) => c.area >= minArea && c.area <= maxArea).sort((a, b) => b.area - a.area);

  // Build the label-map + fabric-mask raw RGBA buffers.
  const labelMap = Buffer.alloc(W * H * 4);
  const fabricMask = Buffer.alloc(W * H * 4);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const p = (y * W + x) * 4; fabricMask[p] = 255; fabricMask[p + 1] = 255; fabricMask[p + 2] = 255; fabricMask[p + 3] = 255;
  }
  for (let p = 3; p < labelMap.length; p += 4) labelMap[p] = 255; // opaque
  kept.forEach((c, idx) => {
    const [r, g, b] = instanceColor(idx);
    for (const p of c.pixels) { const q = p * 4; labelMap[q] = r; labelMap[q + 1] = g; labelMap[q + 2] = b; }
  });

  return {
    width: W, height: H, count: kept.length,
    instances: kept.map((c) => ({
      area: c.area,
      bbox: { x: c.minx / W, y: c.miny / H, w: (c.maxx - c.minx + 1) / W, h: (c.maxy - c.miny + 1) / H },
    })),
    labelMap, fabricMask,
  };
}

/** Write <prefix>.mask.png + <prefix>.instances.png next to each other. */
export async function writeSegmentation(imagePath: string, outPrefix: string, opts: SegmentOptions = {}): Promise<{ count: number; maskPath: string; labelPath: string }> {
  const r = await segmentMotifs(imagePath, opts);
  await mkdir(path.dirname(outPrefix), { recursive: true });
  const maskPath = `${outPrefix}.mask.png`, labelPath = `${outPrefix}.instances.png`;
  await sharp(r.fabricMask, { raw: { width: r.width, height: r.height, channels: 4 } }).png().toBuffer().then((b) => writeFile(maskPath, b));
  await sharp(r.labelMap, { raw: { width: r.width, height: r.height, channels: 4 } }).png().toBuffer().then((b) => writeFile(labelPath, b));
  return { count: r.count, maskPath, labelPath };
}

// CLI: npx tsx eval/segmentMotifs.ts <image> <outPrefix> [deltaE] [minAreaFrac] [maxAreaFrac]
async function main() {
  const [img, prefix, de, minF, maxF] = process.argv.slice(2);
  if (!img || !prefix) { console.log("usage: tsx eval/segmentMotifs.ts <image> <outPrefix> [deltaE] [minAreaFrac] [maxAreaFrac]"); return; }
  const r = await writeSegmentation(img, prefix, {
    deltaE: de ? Number(de) : undefined,
    minAreaFrac: minF ? Number(minF) : undefined,
    maxAreaFrac: maxF ? Number(maxF) : undefined,
  });
  console.log(`segmented ${r.count} motifs (APPROX) -> ${r.maskPath}, ${r.labelPath}`);
}
if (process.argv[1] && path.basename(process.argv[1]).includes("segmentMotifs")) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
