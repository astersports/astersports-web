/**
 * Detector accuracy harness for the SCALE flip gate (G3, scale half).
 *
 * checkRepeatAdvanced/detectRepeat decides whether scale runs: ALLOVER → scale;
 * placement/border → reject (NON_REPEAT_SCALE_ERROR). This module feeds synthetic
 * allover / placement / border fabrics through detectRepeat and reports whether the
 * scale gate would ACCEPT (allover) or REJECT (everything else) — i.e. whether a
 * real repeating print scales and a placement-print garment (the −50% "split in
 * two" case) is correctly refused.
 *
 * Consumed by detectorAccuracy.test.ts (CI regression guard) and runnable ad-hoc
 * for calibration:  corepack pnpm exec tsx server/_core/studio/eval/detectorAccuracy.ts
 */
import { detectRepeat } from "../ops/repeatDetector";

const W = 256, H = 256;
const FM0 = 24, FM1 = 232; // fabric rect [24,232) ~ 208px square
const BG = [220, 215, 200], FG = [190, 70, 85];

function fabricRaster(): Uint8Array {
  const r = new Uint8Array(W * H);
  for (let y = FM0; y < FM1; y++) for (let x = FM0; x < FM1; x++) r[y * W + x] = 255;
  return r;
}
function blank(): Buffer {
  const b = Buffer.alloc(W * H * 4);
  for (let i = 0; i < W * H; i++) { const p = i * 4; b[p] = BG[0]; b[p + 1] = BG[1]; b[p + 2] = BG[2]; b[p + 3] = 255; }
  return b;
}
function put(b: Buffer, x: number, y: number, c: number[]) {
  if (x < FM0 || x >= FM1 || y < FM0 || y >= FM1) return;
  const p = (y * W + x) * 4; b[p] = c[0]; b[p + 1] = c[1]; b[p + 2] = c[2];
}
function dotGrid(period: number, r = 3): Buffer {
  const b = blank();
  for (let y = FM0; y < FM1; y++) for (let x = FM0; x < FM1; x++) {
    const cx = Math.round(x / period) * period, cy = Math.round(y / period) * period;
    if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) put(b, x, y, FG);
  }
  return b;
}
function checker(period: number): Buffer {
  const b = blank();
  for (let y = FM0; y < FM1; y++) for (let x = FM0; x < FM1; x++)
    if ((Math.floor(x / period) + Math.floor(y / period)) % 2 === 0) put(b, x, y, FG);
  return b;
}
function blob(R: number): Buffer {
  const b = blank(); const cx = (FM0 + FM1) / 2, cy = (FM0 + FM1) / 2;
  for (let y = FM0; y < FM1; y++) for (let x = FM0; x < FM1; x++)
    if ((x - cx) ** 2 + (y - cy) ** 2 <= R * R) put(b, x, y, FG);
  return b;
}
function bandsY(period: number): Buffer {
  const b = blank();
  for (let y = FM0; y < FM1; y++) for (let x = FM0; x < FM1; x++)
    if (Math.floor(y / period) % 2 === 0) put(b, x, y, FG);
  return b;
}

export interface DetectorCase { name: string; img: Buffer; wantAccept: boolean; kind: "allover" | "placement" | "border"; }

/** Synthetic accept (allover) / reject (placement + border) corpus. */
export function detectorCases(): DetectorCase[] {
  return [
    { name: "allover dots p12", img: dotGrid(12), wantAccept: true, kind: "allover" },
    { name: "allover dots p16", img: dotGrid(16), wantAccept: true, kind: "allover" },
    { name: "allover dots p24", img: dotGrid(24), wantAccept: true, kind: "allover" },
    { name: "allover dots p32", img: dotGrid(32, 5), wantAccept: true, kind: "allover" },
    { name: "allover checker p16", img: checker(16), wantAccept: true, kind: "allover" },
    { name: "allover checker p24", img: checker(24), wantAccept: true, kind: "allover" },
    { name: "placement big blob R70", img: blob(70), wantAccept: false, kind: "placement" },
    { name: "placement logo R25", img: blob(25), wantAccept: false, kind: "placement" },
    { name: "border bands-Y p20", img: bandsY(20), wantAccept: false, kind: "border" },
    { name: "border bands-Y p26", img: bandsY(26), wantAccept: false, kind: "border" },
  ];
}

export interface DetectorEvalRow { name: string; wantAccept: boolean; kind: string; accept: boolean; classification: string; confidence: number; correct: boolean; }
export interface DetectorEvalResult {
  rows: DetectorEvalRow[];
  acceptPass: number; acceptTotal: number;  // genuine repeats correctly accepted
  rejectPass: number; rejectTotal: number;  // non-repeats correctly rejected (safety)
}

export function runDetectorEval(): DetectorEvalResult {
  const raster = fabricRaster();
  const rows: DetectorEvalRow[] = [];
  let acceptPass = 0, acceptTotal = 0, rejectPass = 0, rejectTotal = 0;
  for (const c of detectorCases()) {
    const res = detectRepeat(c.img, W, H, raster);
    const accept = res.isAllover;
    const correct = accept === c.wantAccept;
    if (c.wantAccept) { acceptTotal++; if (correct) acceptPass++; }
    else { rejectTotal++; if (correct) rejectPass++; }
    rows.push({ name: c.name, wantAccept: c.wantAccept, kind: c.kind, accept, classification: res.classification, confidence: res.confidence, correct });
  }
  return { rows, acceptPass, acceptTotal, rejectPass, rejectTotal };
}

export function formatDetectorEval(r: DetectorEvalResult): string {
  const lines = r.rows.map((row) =>
    `${row.correct ? "PASS" : "FAIL"}  ${row.name.padEnd(22)}  want=${row.wantAccept ? "accept" : "reject"}  got=${row.classification.padEnd(17)}  accept=${row.accept}  conf=${row.confidence.toFixed(2)}`
  );
  lines.push(`\nreject (safety): ${r.rejectPass}/${r.rejectTotal}   accept (quality): ${r.acceptPass}/${r.acceptTotal}`);
  return lines.join("\n");
}

// Ad-hoc CLI (tsx). Guarded so importing the module never auto-runs.
if (process.argv[1] && process.argv[1].endsWith("detectorAccuracy.ts")) {
  const r = runDetectorEval();
  console.log("\n=== SCALE detector accuracy (accept ALLOVER / reject placement+border) ===");
  console.log(formatDetectorEval(r));
  const allCorrect = r.acceptPass === r.acceptTotal && r.rejectPass === r.rejectTotal;
  if (!allCorrect) console.log("\nNote: acceptance under-tuned — calibrate PEAK_RATIO/PERIODICITY_ENERGY/MIN_TILE_REPEATS on a real labeled garment set.");
  process.exit(r.rejectPass === r.rejectTotal ? 0 : 1);
}
