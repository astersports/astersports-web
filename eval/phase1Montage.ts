/**
 * Phase-1 review montages (branch-only artifacts for the orchestrator, who has no
 * web access). Per case: [original | segmenter overlay | preview −30% | preview −50%],
 * labeled with counts, downscaled ≤1600px. Force-committed to eval/out/phase1/.
 * Strip before any merge.
 *
 * Run: npx tsx eval/phase1Montage.ts
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { decodeUpright } from "../server/_core/image/decodeUpright";
import { densityPreview, summarizePreviewStep } from "../server/_core/studio/ops/densityPreview";
import { segmentMotifs, type SegmentOptions } from "./segmentMotifs";
import { loadFabricMask, loadInstanceLabelMap } from "../server/_core/studio/eval/evalMaskIO";
import type { BBoxNormalized } from "../server/_core/masking/types";

const OUT = "eval/out/phase1";
const DIR = "eval/samples/cinqasept-likely";
interface C { id: string; image: string; title: string; bbox: BBoxNormalized; seg: SegmentOptions }
const CASES: C[] = [
  { id: "poppette", image: `${DIR}/scattered__likely__poppette-dress__flatlay.jpg`, title: "LIKELY Poppette — dots", bbox: { x: 0.2, y: 0.55, w: 0.6, h: 0.38 }, seg: { deltaE: 18, maxAreaFrac: 0.012, minAreaFrac: 0.0003 } },
  { id: "stassie", image: `${DIR}/scattered__cinqasept__stassie-dress__flatlay.jpg`, title: "Cinq à Sept Stassie — dots", bbox: { x: 0.18, y: 0.45, w: 0.64, h: 0.30 }, seg: { deltaE: 18, maxAreaFrac: 0.03, minAreaFrac: 0.0005 } },
  { id: "ditsy", image: `${DIR}/scattered__likely__ditsy-floral-marullo-dress__flatlay.jpg`, title: "LIKELY Ditsy Marullo — appliqués", bbox: { x: 0.16, y: 0.18, w: 0.68, h: 0.6 }, seg: { deltaE: 10, maxAreaFrac: 0.03, minAreaFrac: 0.0005 } },
  { id: "tessa", image: `${DIR}/scattered__likely__tessa-gown__flatlay.jpg`, title: "LIKELY Tessa — roses", bbox: { x: 0.18, y: 0.42, w: 0.64, h: 0.5 }, seg: { deltaE: 30, maxAreaFrac: 0.03 } },
];
const LH = 44;
function cap(w: number, t: string, s: string) {
  const e = (x: string) => x.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  return Buffer.from(`<svg width="${w}" height="${LH}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#111"/><text x="8" y="18" font-family="sans-serif" font-size="14" font-weight="700" fill="#fff">${e(t)}</text><text x="8" y="36" font-family="sans-serif" font-size="12" fill="#bbb">${e(s)}</text></svg>`);
}
async function panel(rgba: Buffer, w: number, h: number, t: string, s: string) {
  const body = await sharp(rgba, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
  return sharp({ create: { width: w, height: h + LH, channels: 4, background: { r: 17, g: 17, b: 17, alpha: 1 } } })
    .composite([{ input: cap(w, t, s), top: 0, left: 0 }, { input: body, top: LH, left: 0 }]).png().toBuffer();
}
function overlay(orig: Buffer, label: Buffer, w: number, h: number) {
  const o = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) { const p = i * 4; const m = Math.max(label[p], label[p + 1], label[p + 2]) > 30;
    if (m) { o[p] = 255; o[p + 1] = 0; o[p + 2] = 255; } else { o[p] = (orig[p] * 0.4) | 0; o[p + 1] = (orig[p + 1] * 0.4) | 0; o[p + 2] = (orig[p + 2] * 0.4) | 0; } o[p + 3] = 255; }
  return o;
}
async function run(c: C) {
  const seg = await segmentMotifs(c.image, { bbox: c.bbox, ...c.seg });
  const { width: W, height: H } = seg;
  const work = path.join(OUT, `.work-${c.id}`); await mkdir(work, { recursive: true });
  const imgBuf = await sharp(c.image).resize(W, H, { fit: "fill" }).ensureAlpha().raw().toBuffer();
  const imgPath = path.join(work, "img.png");
  await sharp(imgBuf, { raw: { width: W, height: H, channels: 4 } }).png().toFile(imgPath);
  const maskPath = path.join(work, "mask.png"), labelPath = path.join(work, "label.png");
  await sharp(seg.fabricMask, { raw: { width: W, height: H, channels: 4 } }).png().toFile(maskPath);
  await sharp(seg.labelMap, { raw: { width: W, height: H, channels: 4 } }).png().toFile(labelPath);
  const { raster, bbox } = await loadFabricMask(maskPath, W, H);
  const { instances } = await loadInstanceLabelMap(labelPath, W, H);
  const { buffer: orig } = await decodeUpright(imgPath);
  const pv = await densityPreview({ image: { url: imgPath }, fabric: { bbox, confidence: 1, provider: "sam2", raster }, instances, percents: [30, 50] });
  const panels = [
    await panel(orig, W, H, c.title, `${pv.totalMotifs} motifs detected (approx)`),
    await panel(overlay(orig, seg.labelMap, W, H), W, H, "segmentation", `${seg.count} instances · magenta=motif`),
    await panel(pv.steps[0].data, W, H, "−30%", summarizePreviewStep(pv.steps[0]).split("→")[1]?.trim() ?? ""),
    await panel(pv.steps[1].data, W, H, "−50%", summarizePreviewStep(pv.steps[1]).split("→")[1]?.trim() ?? ""),
  ];
  const gap = 6, ph = H + LH, tw = W * 4 + gap * 3;
  let strip = await sharp({ create: { width: tw, height: ph, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } } })
    .composite(panels.map((input, i) => ({ input, top: 0, left: i * (W + gap) }))).png().toBuffer();
  if (tw > 1600) strip = await sharp(strip).resize(1600).png().toBuffer();
  await writeFile(path.join(OUT, `montage-${c.id}.png`), strip);
  console.log(`montage-${c.id}.png — ${pv.totalMotifs} motifs`);
}
async function main() { await mkdir(OUT, { recursive: true }); for (const c of CASES) await run(c); }
main().catch((e) => { console.error(e); process.exit(1); });
