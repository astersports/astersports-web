/**
 * T0.2 — Unified eval bench runner.
 *
 * Runs all three eval harnesses (density, scale, redistribute) against their
 * synthetic fixture manifests. Exits non-zero if ANY verdict fails — this is
 * the CI gate.
 *
 * Special handling:
 *  - Cases with id containing "MUST-FAIL" are NEGATIVE TESTS: they MUST fail
 *    the verdict. If they pass, that's a regression (the gate isn't catching
 *    the defect). The runner inverts the pass/fail logic for these cases.
 *  - The density bench enforces a two-sided NNI band [1.0, 1.9] to reject both
 *    clustered (R<1) and over-regularized (R>1.9) survivor layouts.
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
import { readFile, access } from "node:fs/promises";
import path from "node:path";
import { runDensityCase, type DensityEvalCase } from "../server/_core/studio/eval/densityEval";
import { runScaleCase, type ScaleEvalCase } from "../server/_core/studio/eval/scaleEval";
import { runRedistributeCase, type RedistributeEvalCase } from "../server/_core/studio/eval/redistributeEval";
import { densityVerdict } from "../server/_core/studio/eval/densityMetrics";
import { ensureRedistributeFixture } from "../server/_core/studio/eval/genRedistributeFixture";
import { EVAL_OUT_DIR } from "../server/_core/studio/eval/evalMaskIO";

// ─── NNI Band Gate (T0.2 requirement) ─────────────────────────────────────
// The two-sided NNI band rejects both clustered AND over-regularized layouts.
// Default: R ∈ [1.0, 1.9]. A perfect hex lattice → R ≈ 2.15, which must FAIL.
const NNI_BAND = { nniMin: 1.0, nniMax: 1.9 };

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

/** Returns true if a case id indicates it's a negative test (must fail). */
function isNegativeTest(id: string): boolean {
  return id.includes("MUST-FAIL") || id.includes("MUST_FAIL");
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
  console.log("id | inst | removed | countErr | survΔE | NNI | infill | verdict | det");
  console.log("─".repeat(95));

  for (const c of cases) {
    const r = await runDensityCase(c);
    if (r.error) {
      console.log(`${r.id} | ERROR: ${r.error}`);
      // Errors on negative tests are acceptable (the op might reject the input)
      if (!isNegativeTest(c.id)) allPass = false;
      continue;
    }
    const m = r.metrics!;
    // Re-compute verdict with the NNI band gate enforced
    const v = densityVerdict(m, NNI_BAND);
    const negative = isNegativeTest(c.id);

    // For negative tests: pass means the gate CORRECTLY rejected it
    const caseOk = negative ? !v.pass : v.pass;
    if (!caseOk) allPass = false;

    const label = negative
      ? (v.pass ? "✗ SHOULD-FAIL" : "✓ CAUGHT")
      : (v.pass ? "✓ PASS" : "✗ FAIL");

    console.log([
      r.id.padEnd(35),
      String(r.instances).padStart(4),
      String(r.removed).padStart(7),
      m.countError.toFixed(3).padStart(9),
      m.survivorIntegrity.toFixed(2).padStart(6),
      m.nniDispersion.toFixed(2).padStart(5),
      m.infillCleanliness.toFixed(2).padStart(7),
      label.padStart(14),
      r.deterministic ? "det" : "NONDET",
    ].join(" | "));
  }
  console.log(`\n[density] NNI band: R ∈ [${NNI_BAND.nniMin}, ${NNI_BAND.nniMax}]`);
  console.log(`[density] ${allPass ? "ALL PASS ✓" : "REGRESSION DETECTED ✗"}`);
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
      if (!isNegativeTest(c.id)) allPass = false;
      continue;
    }
    const m = r.metrics!, v = r.verdict!;
    const negative = isNegativeTest(c.id);
    const caseOk = negative ? !v.pass : v.pass;
    if (!caseOk) allPass = false;

    const label = negative
      ? (v.pass ? "✗ SHOULD-FAIL" : "✓ CAUGHT")
      : (v.pass ? "✓ PASS" : "✗ FAIL");

    console.log([
      r.id.padEnd(22),
      m.measuredFraction.toFixed(3).padStart(8),
      m.scaleRatioError.toFixed(3).padStart(9),
      m.paletteDeltaE.toFixed(2).padStart(10),
      label.padStart(14),
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

  // Auto-generate fixtures if missing (they live in eval/out, gitignored)
  const needsGen = raw.some((c) => {
    for (const u of [c.imageUrl, c.maskUrl, c.labelUrl]) {
      if (!u.startsWith("http")) {
        try { require("node:fs").accessSync(u); } catch { return true; }
      }
    }
    return false;
  });
  if (needsGen) {
    console.log("[redistribute] Generating synthetic fixtures...");
    await ensureRedistributeFixture(EVAL_OUT_DIR);
  }

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
      if (!isNegativeTest(c.id)) allPass = false;
      continue;
    }
    const m = r.metrics!, v = r.verdict!;
    const negative = isNegativeTest(c.id);
    const caseOk = negative ? !v.pass : v.pass;
    if (!caseOk) allPass = false;

    const label = negative
      ? (v.pass ? "✗ SHOULD-FAIL" : "✓ CAUGHT")
      : (v.pass ? "✓ PASS" : "✗ FAIL");

    console.log([
      r.id.padEnd(28),
      String(r.instances).padStart(4),
      String(r.kept).padStart(4),
      m.countError.toFixed(3).padStart(9),
      m.placementEvenness.toFixed(2).padStart(5),
      m.palette.toFixed(2).padStart(6),
      m.perMotif.toFixed(2).padStart(8),
      label.padStart(14),
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
  console.log("  EVAL BENCH — Density & Scale Regression Gate (T0.2)");
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
