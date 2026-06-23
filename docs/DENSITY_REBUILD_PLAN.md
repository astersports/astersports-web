# Density Rebuild — Design & Recommendations

**Status:** proposal for review (CC → Architect, §2.2). No code in this PR — it is the design record.
**Basis:** as-implemented density logic verified against `main` (`file:line` throughout) cross-referenced against published computer-vision/graphics technique (6-validator review, 2026-06-22).
**Companion artifacts:** `docs/ARCHITECT_DECISION_DENSITY_FIXES.txt` (the 3 held money-path fixes #91/#92/#93).

> **Governing caveat — read first.** Every recommendation below is a *literature- and code-derived likely cause*, not confirmed from a failing repro. **No failing input→output sample was available.** Two things gate acting on any quality recommendation: (1) at least one real failure sample (input image + bad output, or a job id), and (2) a real-garment evaluation bench (G3). **Do not start the Tier-2 re-architecture before the eval bench exists** — every Tier-2 choice is an eval question, and committing blind repeats the "build on an unverified premise" failure this review was set up to avoid.

---

## 1. Diagnosis — why a rebuild, not just tuning

**Split finding.** The reliability/money layer (enqueue-before-deduct, idempotent `(refId,reason)` ledger, reaper backstop, atomic claim, no-op→refund) is a sound serverless-job design — **fix-forward, do not re-architect.** The *image algorithm* is the wrong abstraction and is the source of the quality ceiling and most of the failure surface.

**The core mis-abstraction.** A textile print is a **near-regular texture (NRT)** — a deformed lattice of repeating texels. Its "density" is a **lattice property (the repeat period / fundamental frequency)**, not a *count of independent removable objects*. The current pipeline — *segment motifs → delete a count → flat-infill the holes → re-place survivors* — throws away the lattice and makes every stage depend on perfect instance segmentation of a dense repeat, which SAM2 cannot reliably deliver.

**The codebase's own hacks are the tells:**
- `raster` is a full-crop `Uint8Array(...).fill(255)` *because* `combined_mask` is "too sparse on dense prints" (`sam2Provider.ts:170-189`).
- `MAX_INSTANCE_FRACTION = 0.20` drops big segments as "ground" (`sam2Provider.ts:212`).
- `MIN_DENSITY_INSTANCES = 5` under-segmentation warning exists at all (`locateFabricRegion.ts:295`).

**The refund cascade is a quality-failure detector wearing a billing-safety costume.** F1/F2/F3 + `removed===0` + degrade all funnel to "fail + refund." Safe for money, but it means the *expected* output on a hard input is *job failure*, not a worse image. And the eval **excludes `bgDeltaE`** from the verdict (`densityMetrics.ts`, `redistributeMetrics.ts`), so the exact dimension that's failing — infill patch fidelity — is **ungated**: a flat, mis-toned patch can pass.

### Per-symptom root causes (ranked, grounded)

| Symptom | Root cause(s) | `file:line` |
|---|---|---|
| **Segmentation misses motifs** | `points_per_side=16` (Meta default 32) under-samples; `crop_n_layers=0` (small-object recall off); 20% filter nukes merged-print blobs; `validateInstanceCount` warn-only | `replicateSam2.ts:163-171`, `env.ts:87`, `sam2Provider.ts:217-233`, `aiEngine.ts:54-58` |
| **Wrong removal / no-op refunds** | count model is **correct** (perception lit); `baseClothAnchor` null on fully-covered prints; `round(n·p/100)→0` on small n; giant filter eats bold motifs; interiority weight biases removals to center | `densityThin.ts:60-79,89`, `stratifiedSelect.ts:64-100` |
| **Clustered redistribution (v2)** | **layout, not assignment**: 10 fixed Lloyd iters from a regular grid; "empty Voronoi cell keeps its seed" → holes + coincident points; greedy assignment factor-2 suboptimal | `blueNoiseLayout.ts:111,196`, `assignTargets.ts:48-70` |
| **Bad infill / ghost** | flat single dominant-LAB-color fill = averaging-class inpaint; `flatten:true` fixes interior L but boundary/multi-tone ghosts remain | `densityThin.ts:74-78`, `infill.ts:89-94` |
| **Bleed / halo / color shift** | straight-alpha blend in non-linear sRGB 8-bit; 1px feather on binary mask; hard `boundary>127` clip; lossy LAB↔RGB round-trip | `densityRedistribute.ts:263,266-268`, `color.ts:18-30` |
| **Jobs fail / strand** | no internal worker wall-clock timeout (reaper-only, 10 min); async fail/no-op refunds silently (only SSE alerts) | `studioAsyncWorker.ts:34,39`, `studioStream.ts:336` |

---

## 2. Guiding principles for the rebuild

1. **Eval-bench first.** Stand up the G3 real-garment bench before any quality engineering; re-rank everything against measured data, not this literature ranking.
2. **Make it observable before changing behavior.** Per-guard refund-reason telemetry turns "constant refunds" from undiagnosable into measured.
3. **Preserve determinism where free.** Patch-based methods (PatchMatch, quilting), Bridson, Hungarian, linear-light compositing are all deterministic with a fixed seed/order — adopt those before relaxing the no-model constraint.
4. **Relax the no-model constraint only at the one stage it most cripples** (infill quality), behind a flag, with the deterministic path retained as fallback.
5. **Don't touch the reliability layer except the agreed fixes** — it works.

---

## 3. The rebuild, component by component

Each item: current behavior → problem → recommended change → determinism / cost → governance (§2.4) → symptom(s).

### 3.1 Segmentation (recall)
- **Current:** Replicate `meta/sam-2` AMG with `points_per_side=16`, `pred_iou_thresh=0.82`, `stability_score_thresh=0.88`, `use_m2m=false`; `crop_n_layers` not sent (defaults 0). (`replicateSam2.ts:163-171`)
- **Problem:** 16×16 grid = 256 prompt points over the whole crop → most motifs of a dense all-over print never get a seed point → 0/under-segmentation → degrade/refund.
- **Change:**
  1. `points_per_side` **16 → 32** (already env-tunable `STUDIO_SAM2_POINTS_PER_SIDE`; free, reversible). Highest-leverage single change.
  2. Add `crop_n_layers: 1`, `crop_n_points_downscale_factor: 2`, `min_mask_region_area: ~100` to `buildAutoInput`. **[VERIFY]** the hosted Replicate `meta/sam-2` slug accepts these inputs (unknown inputs are silently ignored, not errors) before relying on them.
  3. Add a classical **FFT/autocorrelation periodicity detector** as a *fallback* (not replacement) on the under-segmentation path: recover the repeat period, template-match the unit cell to enumerate instances. Deterministic, sub-second CPU; assumes near-periodic layout.
- **Determinism:** preserved. **Cost:** ~4× SAM2 latency (→ ~30-60s, fine off-request; only `RUN_TIMEOUT_MS=120000` bounds it). **Governance:** params = config; the fallback detector = Architect-scoped (changes what gets billed). **Symptom:** segmentation misses.

### 3.2 Removal selection + count contract
- **Current:** `removeN=clamp(round(n·percent/100),0,n)`; selection = farthest-point on centroids weighted by interiority (edge motifs kept), center seed. (`densityThin.ts:89`, `stratifiedSelect.ts`)
- **Problem:** count model is *correct*, but (a) `round(...)→0` on small n silently no-ops a paid request; (b) interiority + center seed spreads the **holes**, not the **survivors**, biasing removal to the interior ("carve-the-center halo").
- **Change:**
  1. Floor `removeN = max(round(n·p/100), p>0 ? 1 : 0)` — a positive percent on ≥1 instance never silently rounds to a refund.
  2. Replace FPS+interiority selection with **blue-noise / Poisson-disk *subsampling* of the instance set** (keep a maximal evenly-spaced *survivor* subset; remove the rest) — the correct primitive for "thin a point set evenly." Move the edge-infill concern to render-time feather/clip, not selection bias.
- **Determinism:** preserved (deterministic subsample). **Cost:** negligible. **Governance:** `removeN` floor = Architect-scoped (changes billed effect); selection swap = routine (image-op). **Symptom:** wrong removal / refunds.

### 3.3 Base-cloth sampling (the no-op killer)
- **Current:** `baseClothAnchor` keeps pixels `raster>127 && !inAny` (union of *all* instances), returns null if none → F2 refund. (`densityThin.ts:60-79`)
- **Problem:** an all-over print is *defined* by minimal bare ground; `!inAny` excludes everything near motifs, so on dense prints the sample is empty → **constant refunds on exactly the prints users most want to thin.** Likely the #1 no-op cause.
- **Change:** fallback chain before refusing — (a) sample a thin dilation-ring in the inter-motif **gutters** (these almost always exist even on dense prints); (b) sample the lowest-saturation / modal background cluster within the boundary; (c) only then refuse.
- **Determinism:** preserved. **Cost:** negligible. **Governance:** routine (image-op). **Symptom:** no-op refunds.

### 3.4 Infill (texture-aware)
- **Current:** fill every erased pixel toward **one** dominant-LAB color (`kmeans k=3, seed1`, largest cluster), `flatten:true`, 1px feather. (`densityThin.ts:74-78`, `infill.ts:89-94`)
- **Problem:** this is the textbook averaging-class inpaint — flat/blurry/wrong-colored patch on textured fabric (Criminisi, Efros quilting, LaMa all flag mean-color fill); ungated because the eval excludes `bgDeltaE`.
- **Change (staged):**
  1. **Local per-hole base color** — median LAB of bare ground in an annulus around *that* motif, not the global mode (kills wrong-color on multi-tone ground). Low effort, deterministic, ship first.
  2. **Asymmetric/wider feather** — erode the alpha so the blur spreads *inward* only; scale `featherPx` to motif size. Removes the halo + the need for the 2px-dilation hack.
  3. **Poisson (seamless) seam blend** — sparse deterministic solve over each hole with boundary fixed to surrounding pixels; hides any residual patch edge.
  4. **PatchMatch / image-quilting texture synthesis** — the real fix: copy/quilt real bare-ground patches with a min-error boundary cut. **Determinism preserved** with a fixed `mulberry32` seed (the existing convention); CPU-only, no model.
  5. *(Constraint-relaxing, flagged premium path)* **LaMa** deterministic inpainting for genuine weave/print reconstruction. SD-inpaint is **not** reliably deterministic — avoid. LaMa re-enters the §4/G2 sub-processor + cost regime.
- **Determinism:** 1-4 preserved; 5 deterministic forward pass but breaks the no-model contract. **Cost:** 1-2 negligible, 3 modest, 4 moderate CPU, 5 GPU/Replicate. **Governance:** 1-4 routine (image-op); 5 Architect fork (sub-processor/cost). **Symptom:** bad infill / ghost.

### 3.5 Redistribution layout + assignment (v2)
- **Current:** jittered **regular-grid** seed → fixed **10** Lloyd iterations over a strided sample; **empty Voronoi cell keeps its seed**; greedy nearest assignment. (`blueNoiseLayout.ts`, `assignTargets.ts`)
- **Problem:** 10 Lloyd iters from a grid = neither converged blue noise nor clean lattice; "empty cell keeps seed" + many-to-one `snap()` → holes + coincident stacked points (the visible clusters); greedy is factor-2 suboptimal.
- **Change:**
  1. Replace the layout with **Bridson fast Poisson-disk sampling + mask rejection** (background grid `cell=r/√2`, k=30 darts in [r,2r], reject off-fabric candidates). Hard minimum-spacing guarantee → no clusters/coincident points; native hole/concavity support. Hit exactly M by deterministic binary-search on `r`. Deterministic via seeded active-list order.
  2. *(If keeping Lloyd)* re-seed empty cells, early-stop on a movement threshold (not a blind count of 10), start from a Poisson init — strictly inferior to Bridson but cheaper to land.
  3. Upgrade greedy → **Hungarian/Kuhn-Munkres** assignment (N≤200 by the instance cap, trivially affordable; O(N³)) — *after* the layout is fixed, since it only matters once targets are even.
- **Determinism:** all preserved (seeded order, fixed tiebreaks). **Cost:** Bridson O(M); Hungarian O(N³) on N≤200 = negligible. **Governance:** routine (image-op). **Symptom:** clustered redistribution.

### 3.6 Compositing + color
- **Current:** straight (non-premultiplied) alpha blend in **non-linear sRGB 8-bit** (`out=round(out·(1-a)+src·a)`); 1px Gaussian feather of a binary mask; hard `boundary>127` clip; lossy LAB↔RGB round-trip. (`densityRedistribute.ts:263-268`, `color.ts:18-30`)
- **Problem:** sRGB-space blending darkens/shifts every feather-band pixel; straight alpha leaks ground color into the soft edge → halos; the hard silhouette cut → aliased slivers / off-garment bleed.
- **Change:**
  1. **Composite in linear light with premultiplied alpha** — linearize → premultiply → blend → re-encode to sRGB 8-bit once. Fixes halos + fringes together.
  2. **Anti-alias the boundary** — feathered boundary alpha (`blur(~1-1.5px)` of the binary silhouette) multiplied into the motif alpha, instead of the hard `>127` cut. Removes slivers; pairs with adopting #92 (degrade+refund on missing boundary).
  3. Widen/shape the feather; keep determinism (fixed sigma).
  4. **Poisson seam blend** of survivor crops (after 1-3) for the residual "looks pasted" tone seam.
- **Determinism:** preserved (sharp blur + linear math are deterministic). **Cost:** low (1-3), modest (4). **Governance:** routine (image-op core — *not* money/mask path), but re-run G3 eval since rendered output changes. **Symptom:** bleed / halo / shift.

### 3.7 Reliability (fix-forward, do not re-architect)
- **Merge the 3 held PRs:** #91 (`eq→inArray` claim — strand class), #92 (boundary degrade→refund — stops shipping bg-bleed as success), #93 (attempt-scoped refund key + `log.warn`/`notifyOwner` telemetry). All Architect-scoped, green, held.
- **Add a worker internal deadline** (~90-120s `AbortController`/`Promise.race` around `processPrediction`+op, well under the 10-min reaper) so a hang fails fast + alerts instead of stranding for 10 minutes.
- **Per-guard refund-reason telemetry** — stamp *which* guard fired (F1/F2/F3/round-0/under-seg/degrade) on every refund + a dead-letter/alert owner on repeated async fail. This is the **observability prerequisite** for trusting any of §3's cause-ranking in prod.
- **Governance:** all Architect-scoped (money path). **Symptom:** strand + blindness.

### 3.8 Evaluation bench (G3) — the gate
- Build a fixed-runner real-garment eval set with ground-truth instance labels, exercising both v1/v2 across print types (sparse/dense, regular/scattered, mono/multi-tone, bold/fine). Surface the currently-excluded **`bgDeltaE`** (infill fidelity) as a first-class metric. **This is the gate for every Tier-2 decision and for re-ranking Tier 1.**

---

## 4. Strategic option — the NRT lattice re-architecture (long-term)

The eventual right abstraction: **don't detect-and-delete; edit the lattice.**
- Recover the print's lattice + deformation field (FFT/autocorrelation → fundamental period; Liu-Lin-Hays *Near-Regular Texture Analysis and Manipulation*).
- Density becomes a **continuous, segmentation-free** control: change the repeat period, then **re-synthesize** the print at the new density (example-based texture re-synthesis).
- Collapses brittleness #1 (segmentation dependence), #2 (refund cascade), and the determinism-vs-quality ceiling at once.
- **High effort, bench-heavy.** Sequence it *after* the texture-aware-infill swap (§3.4.4) proves the quality ceiling is the blocker. Full Architect fork.

---

## 5. Sequencing roadmap

### Tier 0 — observable + free high-ROI (do first)
Per-guard refund-reason telemetry (§3.7) · `points_per_side`→32 (§3.1) · merge #91/#92/#93 · stand up the G3 eval bench (§3.8).

### Tier 1 — quick wins within the current approach (deterministic, low effort)
Base-cloth gutter-ring fallback (§3.3) · `removeN≥1` floor (§3.2) · linear-light premultiplied compositing + AA boundary + wider feather (§3.6) · local per-hole infill color (§3.4.1) · blue-noise empty-cell fix / Bridson (§3.5) · actionable `validateInstanceCount` (§3.1) · worker deadline + dead-letter (§3.7).

### Tier 2 — strategic (gated on eval bench + Architect fork)
Texture-aware infill (§3.4.4, then optionally 3.4.5) · NRT lattice density (§4) · Hungarian assignment (§3.5.3).

**Hard gate:** no Tier-2 engineering before the G3 bench exists.

---

## 6. Open questions / still ungrounded

- **[VERIFY] No failure sample.** The entire §1/§3 cause-ranking is literature+code-derived, not confirmed from a repro. One bad input→output (or a job id) lets CC confirm which cause fires first.
- **[VERIFY] Replicate `meta/sam-2` input schema** — whether the hosted slug accepts `crop_n_layers` / `min_mask_region_area` (page fetches were rate-limited). Unknown inputs are silently ignored.
- **[VERIFY] `seg.combined` content** — the parked fork (silhouette vs sparse motif union, `ARCHITECT_DECISION_DENSITY_FIXES.txt`); a live all-over-print dump is still owed and affects §3.5/§3.6.
- **No prod refund-reason data** — Tier-0 telemetry must land before the §3.2/§3.3 ranking can be trusted over real traffic.

---

## 7. Source index
Infill: Criminisi (CVPR'03/TIP'04) · PatchMatch (TOG'09) · Efros-Freeman image quilting · LaMa (arXiv 2109.07161) · Pérez Poisson editing (IPOL). Sampling: Bridson 2007 · de Goes 2012 (optimal-transport blue noise) · Balzer 2009 (capacity-constrained) · Du-Faber-Gunzburger (CVT survey). Assignment: Hungarian/Kuhn-Munkres · Dong-Gao-Peng (OT). Perception (count model): Burr/Anobile (PMC4909146) · Durgin · Dakin et al. (PNAS). Segmentation: SAM2 AMG defaults (DeepWiki) · SAM AMG source (facebookresearch) · printed-fabric repeat detection (S0950705124007913). Compositing: Ciechanowski (alpha compositing) · premultiplied-vs-straight · Pérez Poisson cloning. Reliability: Azure background-jobs · durable-execution patterns. (Full URLs in the validation transcripts; mirror in `/home/admin/DENSITY_VALIDATION_REPORT.md`.)
