# Spec — Studio "Proportional Density Redistribution" (Density op **v2**)

**Repo:** `astersports/astersports-web` · **Area:** `server/_core/studio/`
**Status:** DARK. New feature behind a flag, not router-wired. **Draft PR only — do not merge, do not flip any flag.**
**Author of spec:** Claude (claude.ai, read-only review session) · **Executor:** Claude Code
**Supersedes in intent (not in code):** the eval-only, erase-only `densityThin` v1.

---

## 0. Read this first (governance — non-negotiable)

This repo had a live-flag incident; `CLAUDE.md` governs. The executing agent MUST:

1. **Branch, never `main`.** Work on `feat/density-redistribute`. Open a **DRAFT** PR. Never push to `main`, never merge.
2. **Own identity.** Commit as the agent's own git identity. **Do NOT** set `user.email=admin@legacyhoopers.org` or author as "Frank Samaritano." `Co-Authored-By:` is fine; author laundering is not.
3. **Ship dark.** The op is gated by a NEW flag `STUDIO_DENSITY_REDISTRIBUTE` (default **off**) and is **not** wired into any router. Wiring + flipping the flag is **Frank's** call after gates clear (§1/§6) — not a side effect of this PR.
4. **Don't touch the money path.** No edits to credit/billing/webhook logic. If redistribution implies a billable "regenerate," leave a `TODO(architect)` and stop — that's Architect-scoped (§4).
5. **Don't alter live behavior.** If you touch `aiEngine.ts`, add a new entrypoint **additively** behind the flag. Do not change the existing (currently-live) density path's behavior.
6. **Stay in scope.** Do not reactively "fix" unrelated findings you encounter. Note them in the PR body; don't patch them.
7. **PR body must declare** what ships dark, which decision points (below) need Frank/Architect sign-off, and confirm typecheck + tests + eval thresholds are green.

---

## 1. Objective

The Studio "density" control reduces how many motif **instances** appear on a garment. **v2 redefines the behavior** to the company standard:

> Remove `p%` of motifs, then **redistribute the remaining motifs to an even (blue-noise) layout across the garment** — "proportional density redistribution."

Concretely: density `ρ = N/A` (motif count per fabric area). Reducing by `p` yields `ρ' = (1−p)·ρ`, and the surviving motifs are **relocated** so local density is uniform everywhere (no holes, no clusters).

### What changes vs. v1 `densityThin`
- v1 is **erase-only** and guarantees survivors are **byte-identical (unmoved)**. v2 **moves** survivors. v1 cannot be "fixed" into v2 — **this is a new op.**
- The "byte-identical survivor" invariant is **dropped**. The new invariant is **"same motif identity + same scale, new position."**

### Non-goals (explicit)
- Not erase-only thinning (that's v1).
- Not preserving survivor position.
- Not increasing density / adding motifs (separate spec).
- Not turning the feature on.

---

## 2. Decision points (defaults chosen; Architect/Frank ratifies)

| ID | Decision | Default for v2 | Variant / future |
|----|----------|----------------|------------------|
| D1 | Render strategy | **Hybrid**: deterministic layout (§3 steps 1–3) + generative render (step 4) via `aiEngine` | pure-generative (no layout control) or pure-deterministic compositor (hardest to make photoreal) |
| D2 | Target density field | **Uniform/even** (flat) at reduced count | graded/ombré: feed a `(1−p)`-scaled copy of original local density as target — one flag, same math |
| D3 | Motif orientation | **Preserve** original rotation | re-orient for packing — future flag |
| D4 | Count rounding | `round(p·N)`, clamp `p ∈ [0, DENSITY_MAX]` (reuse existing `DENSITY_MAX=90`) | — |

**Rationale for D1 = hybrid:** the deterministic layout *is* the company standard (reproducible, auditable); the generative step is only for photoreal pixels. Pure-deterministic compositing on a real garment photo (matching fold/lighting/warp by hand) is the highest-risk path; pure-generative surrenders layout control so there's no standard to enforce.

---

## 3. Algorithm (the standard, as a formula)

Input: decoded RGBA image (`buffer,width,height`), `fabric: FabricMask` **with `.raster`** (area `A` = fabric pixels), `instances: InstanceMask[]` (count `N`), `percent` (→ `p = percent/100`).

**Step 1 — Count.**
`M = N − round(p·N)` survivors kept. (`p=0.30, N=100 → keep 70`.) If `N==0 || p<=0 || round(p·N)==0` → no-op return (refund), `removed:0`.

**Step 2 — Even target layout (deterministic).**
Generate `M` target positions uniformly (blue-noise) inside the fabric raster:
- Seed with Poisson-disk dart-throwing (or jittered grid) at conflict radius `r ≈ c·√(A/M)`, `c ≈ 0.8` (tune), **clipped to `fabric.raster`** and inset by a seam/edge margin so motifs don't land on garment boundaries.
- Refine with **Lloyd relaxation / centroidal Voronoi**, ~10 iterations, each point moved to its Voronoi-cell centroid clipped to the mask.
- **Deterministic:** fixed seed (e.g. `seed=1`), no RNG that varies between runs. Output is byte-stable.
- D2 variant: bias point density by a target field `T(x,y)` instead of flat.

**Step 3 — Assignment (deterministic).**
Match each surviving motif → one target minimizing **total displacement** (motifs move as little as possible, preserving the look of the original):
- Optimal-transport / Hungarian assignment (O(M³) fine for M ≤ few hundred) or a greedy/auction approximation with fixed tie-breaks (by instance index) for determinism.
- Which motifs survive = the `M` not chosen for removal. Choose removals/survivors by **weighted sample elimination** (remove the most-crowded; keep the well-spaced) so the kept set is already close to even before relocation — minimizes motion.

**Step 4 — Render (D1 = hybrid).**
- Deterministic part: build the erase region (all original motif pixels), infill base cloth (reuse `infillBaseCloth`), and compute per-motif crops (source pixels via SAM2 mask) + target placements + scale.
- Generative part (behind flag, additive in `aiEngine.ts`): render the `M` motif crops at their target positions with fabric-aware blending (fold, lighting, warp), preserving each motif's identity + scale (D3: + rotation).
- Output: `{ data, width, height, kept: M, removed: N−M, targets, assignments }`.

**Determinism boundary:** steps 1–3 are fully deterministic and independently testable; only step-4 generative render is model-dependent. Tests cover 1–3 exhaustively; step 4 gets a fidelity/realism eval (§5).

---

## 4. File plan

**New**
- `server/_core/studio/ops/densityRedistribute.ts` — orchestrator (steps 1–4).
- `server/_core/studio/ops/blueNoiseLayout.ts` — Poisson-disk seed + Lloyd/CVT (step 2).
- `server/_core/studio/ops/assignTargets.ts` — displacement-minimizing matching (step 3).
- `server/_core/studio/ops/sampleEliminate.ts` — weighted sample elimination survivor selection.
- `server/_core/studio/eval/redistributeMetrics.ts` — reworked metrics (§5).
- Tests: `densityRedistribute.test.ts`, `blueNoiseLayout.test.ts`, `assignTargets.test.ts`, `redistributeMetrics.test.ts` (synthetic-data, mirror `densityThin.test.ts` style).

**Reuse (do not modify behavior)**
- `infill.ts` (`infillBaseCloth`), `image/decodeUpright`, `masking/types`, `ops/color`, `ops/kmeans`.

**Touch additively, behind flag**
- `aiEngine.ts` — new `renderMotifsAtTargets(...)` entrypoint only; gated by `STUDIO_DENSITY_REDISTRIBUTE`.
- env/flag registry — add `STUDIO_DENSITY_REDISTRIBUTE` (default off).

**Do not touch**
- `densityThin.ts` (leave v1 intact as eval baseline/fallback), `webhook.ts`, `studioDb.ts` grant/credit logic, any router wiring.

---

## 5. Validation / acceptance (eval harness)

Rework `densityThin`'s metrics for the moved-survivor world. `verdict.pass` requires all of:

- **countError** ≤ 0.10 — measured removal fraction vs `p` (M correct).
- **placementEvenness** — NNI (Clark-Evans + Donnelly boundary correction) on **FINAL** motif centroids ≥ 1.0 (dispersed). *(Note: v1 measured evenness on the removed set; v2 measures it on the final layout.)*
- **motifFidelity** — relocated motif still matches its source design: ΔE2000 and/or SSIM between source motif crop and rendered motif crop ≥ threshold (start: SSIM ≥ 0.9 — tune).
- **scaleFidelity** — `|scale_out − scale_in| / scale_in` ≤ 0.05.
- **ghosting** — residual edge energy at vacated sites ≤ 2.5× bare-ground baseline (reuse `infillCleanliness`).
- **densityAccuracy** — measured final density within tolerance of `(1−p)·ρ`.
- **no-op refund guard retained** — if nothing effectively changed, report `removed:0` so the caller refunds (never bill a byte-identical or failed redistribution).

Deterministic steps (1–3) get exact synthetic-data unit tests (counts, determinism via `Buffer.compare`/`toEqual`, even-spread assertions). Step-4 fidelity runs on a small real-image set behind the flag.

---

## 6. Interfaces (sketch — adjust to repo conventions)

```ts
export interface RedistributeInput {
  image: MaskImageInput;
  fabric: FabricMask;          // MUST carry .raster
  instances: InstanceMask[];
  percent: number;             // 0..DENSITY_MAX
  options?: { targetField?: (x: number, y: number) => number; seed?: number };
}
export interface RedistributeResult extends InfillResult {
  kept: number;
  removed: number;
  targets: Array<[number, number]>;     // final positions (px)
  assignments: Array<{ from: number; to: [number, number] }>;
}
export function blueNoiseLayout(raster: RasterMask, m: number, seed?: number): Array<[number, number]>;
export function assignTargets(survivors: Array<[number, number]>, targets: Array<[number, number]>): number[];
export function sampleEliminate(instances: InstanceMask[], keepM: number, w: number, h: number): { survivors: number[]; removed: number[] };
export async function densityRedistribute(input: RedistributeInput): Promise<RedistributeResult>;
```

---

## 7. Open questions for Frank / Architect (resolve before any wiring)

- Ratify D1–D4 (esp. D1 hybrid, D3 orientation).
- Real-image render quality bar + model choice for step 4.
- Keep v1 `densityThin` as a deterministic fallback, or retire it?
- Billing semantics of a redistribute "run" (Architect-scoped — out of this PR).

## 8. Out of scope
Increasing density (adding motifs); graded/ombré target (D2 variant, not v2 default); router wiring; flipping `STUDIO_DENSITY_REDISTRIBUTE`.
