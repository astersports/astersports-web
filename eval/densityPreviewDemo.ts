/**
 * EVAL-ONLY demo: render the Phase-1 density 10/20/50% preview on a REAL client
 * garment, end-to-end and offline (no SAM2). Pipeline:
 *   segmentMotifs (approx instance label-map) -> densityPreview -> labeled strip PNG.
 *
 * It proves the preview runs + counts on a real Cinq à Sept / LIKELY piece. The
 * instance counts are APPROX (segmentMotifs is a contrast+CC stand-in, not SAM2 —
 * see its header + strategy-doc §5); the count GATE still needs SAM2. This is a
 * visual/behaviour demo, not the G3 gate.
 *
 * Usage (config block below, or pass an id):  npx tsx eval/densityPreviewDemo.ts [poppette|tessa]
 * Output: eval/out/density-preview-<id>.png
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { decodeUpright } from "../server/_core/image/decodeUpright";
import { densityPreview, summarizePreviewStep } from "../server/_core/studio/ops/densityPreview";
import { segmentMotifs } from "./segmentMotifs";
import { loadFabricMask, loadInstanceLabelMap, EVAL_OUT_DIR } from "../server/_core/studio/eval/evalMaskIO";
import type { BBoxNormalized } from "../server/_core/masking/types";
import type { SegmentOptions } from "./segmentMotifs";

interface DemoCase { id: string; image: string; seg: SegmentOptions & { bbox: BBoxNormalized }; title: string; }

const CASES: Record<string, DemoCase> = {
  poppette: {
    id: "poppette",
    image: "eval/samples/cinqasept-likely/scattered__likely__poppette-dress__flatlay.jpg",
    title: "LIKELY · Poppette (black dots / grey ground)",
    seg: { bbox: { x: 0.2, y: 0.55, w: 0.6, h: 0.38 }, deltaE: 18, maxAreaFrac: 0.012, minAreaFrac: 0.0003 },
  },
  tessa: {
    id: "tessa",
    image: "eval/samples/cinqasept-likely/scattered__likely__tessa-gown__flatlay.jpg",
    title: "LIKELY · Tessa (scattered roses / dark ground)",
    seg: { bbox: { x: 0.18, y: 0.42, w: 0.64, h: 0.5 }, deltaE: 30, maxAreaFrac: 0.03 },
  },
};

const PANEL_LABEL_H = 46;

/** A text caption band above a panel. */
function captionSvg(w: number, text: string, sub: string): Buffer {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  return Buffer.from(
    `<svg width="${w}" height="${PANEL_LABEL_H}" xmlns="http://www.w3.org/2000/svg">` +
    `<rect width="100%" height="100%" fill="#111"/>` +
    `<text x="10" y="19" font-family="sans-serif" font-size="15" font-weight="700" fill="#fff">${esc(text)}</text>` +
    `<text x="10" y="38" font-family="sans-serif" font-size="13" fill="#bbb">${esc(sub)}</text>` +
    `</svg>`
  );
}

async function panel(rgba: Buffer, w: number, h: number, label: string, sub: string): Promise<Buffer> {
  const body = await sharp(rgba, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
  return sharp({ create: { width: w, height: h + PANEL_LABEL_H, channels: 4, background: { r: 17, g: 17, b: 17, alpha: 1 } } })
    .composite([{ input: captionSvg(w, label, sub), top: 0, left: 0 }, { input: body, top: PANEL_LABEL_H, left: 0 }])
    .png().toBuffer();
}

/** Tint motif pixels magenta over a dimmed original — to eyeball segmentation alignment. */
function overlay(orig: Buffer, label: Buffer, w: number, h: number): Buffer {
  const out = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const p = i * 4;
    const isMotif = Math.max(label[p], label[p + 1], label[p + 2]) > 30;
    if (isMotif) { out[p] = 255; out[p + 1] = 0; out[p + 2] = 255; }
    else { out[p] = (orig[p] * 0.45) | 0; out[p + 1] = (orig[p + 1] * 0.45) | 0; out[p + 2] = (orig[p + 2] * 0.45) | 0; }
    out[p + 3] = 255;
  }
  return out;
}

async function run(c: DemoCase) {
  const seg = await segmentMotifs(c.image, c.seg);
  const { width: W, height: H } = seg;

  // Materialize the resized image + masks at the segmenter's dims so the op + masks agree.
  const work = path.join(EVAL_OUT_DIR, `work-${c.id}`);
  await mkdir(work, { recursive: true });
  const imgBuf = await sharp(c.image).resize(W, H, { fit: "fill" }).ensureAlpha().raw().toBuffer();
  const imgPath = path.join(work, "img.png");
  await sharp(imgBuf, { raw: { width: W, height: H, channels: 4 } }).png().toBuffer().then((b) => writeFile(imgPath, b));
  const maskPath = path.join(work, "mask.png"), labelPath = path.join(work, "label.png");
  await sharp(seg.fabricMask, { raw: { width: W, height: H, channels: 4 } }).png().toBuffer().then((b) => writeFile(maskPath, b));
  await sharp(seg.labelMap, { raw: { width: W, height: H, channels: 4 } }).png().toBuffer().then((b) => writeFile(labelPath, b));

  const { raster, bbox } = await loadFabricMask(maskPath, W, H);
  const { instances } = await loadInstanceLabelMap(labelPath, W, H);
  const { buffer: orig } = await decodeUpright(imgPath);

  const preview = await densityPreview({
    image: { url: imgPath },
    fabric: { bbox, confidence: 1, provider: "sam2", raster },
    instances,
  });

  console.log(`\n=== ${c.title} ===`);
  console.log(`detected ${preview.totalMotifs} motifs (APPROX, classical CC — not SAM2)`);
  for (const s of preview.steps) console.log("  " + summarizePreviewStep(s));

  // Strip: [original] [segmentation overlay] [-10%] [-20%] [-50%]
  const panels: Buffer[] = [];
  panels.push(await panel(orig, W, H, "ORIGINAL", `${preview.totalMotifs} motifs detected`));
  panels.push(await panel(overlay(orig, seg.labelMap, W, H), W, H, "SEGMENTATION (approx)", `${seg.count} instances · magenta = motif`));
  for (const s of preview.steps) {
    panels.push(await panel(s.data, W, H, `−${s.percent}%  (${s.kept} remain)`, s.noop ? "NO-OP / refund" : `removed ${s.removed} of ${s.totalMotifs}`));
  }

  const gap = 6;
  const panelH = H + PANEL_LABEL_H;
  const totalW = W * panels.length + gap * (panels.length - 1);
  const composites = panels.map((input, i) => ({ input, top: 0, left: i * (W + gap) }));
  const strip = await sharp({ create: { width: totalW, height: panelH, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } } })
    .composite(composites).png().toBuffer();
  await mkdir(EVAL_OUT_DIR, { recursive: true });
  const outPath = path.join(EVAL_OUT_DIR, `density-preview-${c.id}.png`);
  await writeFile(outPath, strip);
  console.log(`strip -> ${path.relative(process.cwd(), outPath)}`);
  return outPath;
}

async function main() {
  const which = process.argv[2];
  const cases = which ? [CASES[which]].filter(Boolean) : Object.values(CASES);
  if (cases.length === 0) { console.log(`unknown case '${which}'. known: ${Object.keys(CASES).join(", ")}`); return; }
  for (const c of cases) await run(c);
}
if (process.argv[1] && path.basename(process.argv[1]).includes("densityPreviewDemo")) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
