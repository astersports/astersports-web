/**
 * T0.2 — Unified eval bench runner.
 *
 * Runs all three eval harnesses (density, scale, redistribute) against their
 * synthetic fixture manifests. Exits non-zero if ANY verdict fails — this is
 * the CI gate.
 *
 * Usage:
 *   pnpm eval              (runs all three)
 *   pnpm eval:density      (density only)
 *   pnpm eval:scale        (scale only)
 *   pnpm eval:redistribute (redistribute only)
 *
 * The runner adapts the manifest field names to the harness interfaces:
 *   - density manifest uses rasterUrl/instanceLabelsUrl → harness expects maskUrl/labelUrl
 *   - scale manifest uses rasterUrl/targetFraction → harness expects maskUrl/percent
 *   - redistribute manifest already matches
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { runDensityCase, type DensityEvalCase } from "../server/_core/studio/eval/densityEval";
import { runScaleCase, type ScaleEvalCase } from "../server/_core/studio/eval/scaleEval";
import { runRedistributeCase, type RedistributeEvalCase } from "../server/_core/studio/eval/redistributeEval";

// ─── Manifest adapters ──────────────────────────────────────────────────────

interface RawDensityManifestCase {
  id: string;
  imageUrl: string;
  percent: number;
  bbox?: { x: number; y: number; w: number; h: number };
  rasterUrl?: string;
  maskUrl?: string;
  instanceLabelsUrl?: string;
  labelUrl?: string;
  truthMaskUrl?: string;
  note?: string;
}

interface RawScaleManifestCase {
  id: string;
  imageUrl: string;
  targetFraction?: number;
  percent?: number;
  bbox?: { x: number; y: number; w: number; h: number };
  rasterUrl?: string;
  maskUrl?: string;
  note?: string;
}

function adaptDensityManifest(raw: RawDensityManifestCase[]): DensityEvalCase[] {
  return raw.map((c) => ({
    id: c.id,
    imageUrl: c.imageUrl,
    percent: c.percent,
    maskUrl: c.maskUrl || c.rasterUrl || "",
    labelUrl: c.labelUrl || c.instanceLabelsUrl || "",
    note: c.note,
  }));
}

function adaptScaleManifest(raw: RawScaleManifestCase[]): ScaleEvalCase[] {
  return raw.map((c) => ({
    id: c.id,
    imageUrl: c.imageUrl,
    // Scale harness expects percent (signed); manifest may have targetFraction instead
    percent: c.percent ?? Math.round((c.targetFraction! - 1) * 100),
    maskUrl: c.maskUrl || c.rasterUrl || "",
    note: c.note,
  }));
}

// ─── Harness runners ────────────────────────────────────────────────────────

async function runDensityBench(): Promise<boolean> {
  const manifestPath = "eval/samples/density.manifest.json";
  const raw: RawDensityManifestCase[] = JSON.parse(await readFile(manifestPath, "utf8"));
  if (raw.length === 0) { console.log("[density] No cases. Skipping."); return true; }

  const cases = adaptDensityManifest(raw);
  let allPass = true;
  console.log("\n╔══════════════════════════════════════════╗");
  console.log("║         DENSITY EVAL BENCH               ║");
  console.log("╚══════════════════════════════════════════╝");
  console.log("id | inst | removed | countErr | survΔE | evenness | infill | verdict | det");
  console.log("─".repeat(90));

  for (const c of cases) {
    const r = await runDensityCase(c);
    if (r.error) {
      console.log(`${r.id} | ERROR: ${r.error}`);
      allPass = false;
      continue;
    }
    const m = r.metrics!, v = r.verdict!;
    if (!v.pass) allPass = false;
    console.log([
      r.id.padEnd(22),
      String(r.instances).padStart(4),
      String(r.removed).padStart(7),
      m.countError.toFixed(3).padStart(9),
      m.survivorIntegrity.toFixed(2).padStart(6),
      m.evenness.toFixed(2).padStart(9),
      m.infillCleanliness.toFixed(2).padStart(7),
      (v.pass ? "✓ PASS" : "✗ FAIL").padStart(8),
      r.deterministic ? "det" : "NONDET",
    ].join(" | "));
  }
  console.log(`\n[density] ${allPass ? "ALL PASS ✓" : "REGRESSION DETECTED ✗"}`);
  return allPass;
}

async function runScaleBench(): Promise<boolean> {
  const manifestPath = "eval/samples/scale.manifest.json";
  const raw: RawScaleManifestCase[] = JSON.parse(await readFile(manifestPath, "utf8"));
  if (raw.length === 0) { console.log("[scale] No cases. Skipping."); return true; }

  const cases = adaptScaleManifest(raw);
  let allPass = true;
  console.log("\n╔══════════════════════════════════════════╗");
  console.log("║          SCALE EVAL BENCH                ║");
  console.log("╚══════════════════════════════════════════╝");
  console.log("id | measFrac | ratioErr | paletteΔE | verdict | det");
  console.log("─".repeat(70));

  for (const c of cases) {
    const r = await runScaleCase(c);
    if (r.error) {
      console.log(`${r.id} | ERROR: ${r.error}`);
      allPass = false;
      continue;
    }
    const m = r.metrics!, v = r.verdict!;
    if (!v.pass) allPass = false;
    console.log([
      r.id.padEnd(22),
      m.measuredFraction.toFixed(3).padStart(8),
      m.scaleRatioError.toFixed(3).padStart(9),
      m.paletteDeltaE.toFixed(2).padStart(10),
      (v.pass ? "✓ PASS" : "✗ FAIL").padStart(8),
      r.deterministic ? "det" : "NONDET",
    ].join(" | "));
  }
  console.log(`\n[scale] ${allPass ? "ALL PASS ✓" : "REGRESSION DETECTED ✗"}`);
  return allPass;
}

async function runRedistributeBench(): Promise<boolean> {
  const manifestPath = "eval/samples/redistribute.manifest.json";
  let raw: RedistributeEvalCase[];
  try {
    raw = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch {
    console.log("[redistribute] No manifest found. Skipping.");
    return true;
  }
  if (raw.length === 0) { console.log("[redistribute] No cases. Skipping."); return true; }

  let allPass = true;
  console.log("\n╔══════════════════════════════════════════╗");
  console.log("║     REDISTRIBUTE EVAL BENCH              ║");
  console.log("╚══════════════════════════════════════════╝");
  console.log("id | inst | kept | countErr | NNI | palΔE | motifΔE | verdict | det");
  console.log("─".repeat(80));

  for (const c of raw) {
    const r = await runRedistributeCase(c);
    if (r.error) {
      console.log(`${r.id} | ERROR: ${r.error}`);
      allPass = false;
      continue;
    }
    const m = r.metrics!, v = r.verdict!;
    if (!v.pass) allPass = false;
    console.log([
      r.id.padEnd(28),
      String(r.instances).padStart(4),
      String(r.kept).padStart(4),
      m.countError.toFixed(3).padStart(9),
      m.placementEvenness.toFixed(2).padStart(5),
      m.palette.toFixed(2).padStart(6),
      m.perMotif.toFixed(2).padStart(8),
      (v.pass ? "✓ PASS" : "✗ FAIL").padStart(8),
      r.deterministic ? "det" : "NONDET",
    ].join(" | "));
  }
  console.log(`\n[redistribute] ${allPass ? "ALL PASS ✓" : "REGRESSION DETECTED ✗"}`);
  return allPass;
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const arg = process.argv[2] || "all";
  const results: { name: string; pass: boolean }[] = [];

  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  EVAL BENCH — Density & Scale Regression Gate");
  console.log("═══════════════════════════════════════════════════════════════");

  if (arg === "all" || arg === "density") {
    results.push({ name: "density", pass: await runDensityBench() });
  }
  if (arg === "all" || arg === "scale") {
    results.push({ name: "scale", pass: await runScaleBench() });
  }
  if (arg === "all" || arg === "redistribute") {
    results.push({ name: "redistribute", pass: await runRedistributeBench() });
  }

  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("  SUMMARY");
  console.log("═══════════════════════════════════════════════════════════════");
  for (const r of results) {
    console.log(`  ${r.pass ? "✓" : "✗"} ${r.name}`);
  }

  const allPass = results.every((r) => r.pass);
  if (!allPass) {
    console.log("\n  ✗ REGRESSION DETECTED — CI should block merge.");
    process.exitCode = 1;
  } else {
    console.log("\n  ✓ All benchmarks pass. Safe to merge.");
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
