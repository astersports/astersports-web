# Scale-live / Density-live router wiring — Builder draft spec

**Date:** 2026-06-20 · **Branch:** `claude/jolly-pascal-k9tw4r` · **Status:** Builder draft; **D-A..D-D RULED & LOCKED** by the Architect (verified at `7c36d8f`). Locked build prompts are **held until the SAM2 privacy gate clears** (so they pin against verified raster + instance-mask shapes).
**Not buildable yet.** Both routes are Rule 19 money-path changes and depend on SAM2 being live, which is gated on the privacy work (4 requirements + the `sam2Provider` review at `005260c`).

Models the proven **A2** pattern (`afac00a`): a deterministic helper in `aiEngine.ts`, a distinct **live** flag, a *control-only* route gate inside `generate`, reuse of the existing deduct/refund/status logic, no-op guard skipped, no pricing change.

---

## Hard preconditions (both routes)
- **Distinct LIVE flags**, separate from the eval flags. The eval flags
  (`STUDIO_DETERMINISTIC_SCALE` / `_DENSITY`) are eval-only and must NOT gate the
  money path. New: `STUDIO_SCALE_LIVE`, `STUDIO_DENSITY_LIVE` (default off).
- **SAM2 / rasterReady required.** Scale needs `fabric.raster`; density needs
  `getInstanceMasks`. The classical floor is `rasterReady:false` and throws. So the
  route must engage deterministic **only when `getMaskProvider().rasterReady`** —
  i.e. `STUDIO_MASK_PROVIDER=sam2` AND provisioned. If not rasterReady, **fall back
  to the existing prompt path** (do not throw, do not break the job).
- **Privacy gate** (Manus): crop-to-fabric minimization, org_id logging, retention,
  fail-safe — done before SAM2 goes live, so before either flag can do anything.

---

## Helpers (aiEngine.ts — mirror `generateRecoloredImage`)

```ts
export async function generateScaledImage(
  originalImageUrl: string, params: { targetFraction: number }
): Promise<Buffer> {
  const srcUrl = resolveSigned(originalImageUrl);
  const fabric = await getMaskProvider().getFabricMask({ url: srcUrl }); // SAM2 -> raster
  if (!hasAnyPixel(fabric.raster)) throw new Error("NO_OP: empty fabric raster"); // D-C
  const r = await scalePrintRepeat({ image: { url: srcUrl }, fabric, targetFraction: params.targetFraction });
  return sharp(r.data, { raw: { width: r.width, height: r.height, channels: 4 } }).png().toBuffer();
}

export async function generateThinnedImage(
  originalImageUrl: string, params: { percent: number }
): Promise<Buffer> {
  const srcUrl = resolveSigned(originalImageUrl);
  const provider = getMaskProvider();
  const fabric = await provider.getFabricMask({ url: srcUrl });            // SAM2 raster
  const instances = await provider.getInstanceMasks({ url: srcUrl }, fabric); // SAM2 instances
  const r = await densityThin({ image: { url: srcUrl }, fabric, instances, percent: params.percent });
  if (r.removed === 0) throw new Error("NO_OP: no motifs removed"); // D-C (covers 0 instances / removeN 0)
  return sharp(r.data, { raw: { width: r.width, height: r.height, channels: 4 } }).png().toBuffer();
}
```
**RGBA shape (verified):** `scalePrintRepeat`/`densityThin` return **raw RGBA**
`{data,width,height}`; encode to PNG using the **op result's** width/height (NOT
the fabric bbox) before `storagePut`. Recolor's `separationRemap` already returns
PNG — this is the one shape difference.
**D-C no-op-billing guard (verified):** both ops passthrough on a degenerate mask;
the helper THROWS on that so the existing refund path fires (no paid no-op). Density
floor (`removed===0`) ships now; the absurdly-many-instances ceiling waits for real
SAM2 data.

---

## Route gate inside `generate` (after controls validation)

```ts
const scaleOnly   = controls.scale.enabled   && !recolor && !density && !remove && controls.scale.percent !== 0;
const densityOnly = controls.density.enabled && !recolor && !scale   && !remove && controls.density.percent > 0;
const rasterReady = getMaskProvider().rasterReady;
const useDeterministicScale   = ENV.studioScaleLive   && scaleOnly   && rasterReady;
const useDeterministicDensity = ENV.studioDensityLive && densityOnly && rasterReady;

// D-A (ruled): reject combined scale/density ONLY when the live flag is on AND
// rasterReady — pre-deduct validation (no credit touched). Flag off => unchanged.
if (ENV.studioScaleLive && rasterReady && controls.scale.enabled && controls.scale.percent !== 0 && !scaleOnly)
  throw new TRPCError({ code: "BAD_REQUEST", message: "Scale can't yet combine with other edits — run it separately." });
if (ENV.studioDensityLive && rasterReady && controls.density.enabled && controls.density.percent > 0 && !densityOnly)
  throw new TRPCError({ code: "BAD_REQUEST", message: "Density can't yet combine with other edits — run it separately." });

// D-B (ruled): live flag on but provider not rasterReady => fall back to the prompt
// path, and WARN (deploy misconfig: SAM2 not serving rasters).
if ((ENV.studioScaleLive || ENV.studioDensityLive) && !rasterReady && (scaleOnly || densityOnly))
  console.warn(`[studio] live flag on but provider not rasterReady; prompt-path fallback. job=${job.id} org=${ctx.tenant.id}`);
```
Inside the `allSettled` task, branch (same shape as A2):
```ts
if (useDeterministicScale) {
  const png = await generateScaledImage(job.originalUrl, { targetFraction: (100 + controls.scale.percent) / 100 });
  const key = `studio/${ctx.tenant.id}/${job.id}/scale-${nextRound}.png`;
  const { url } = await storagePut(key, png, "image/png");
  await addVariation({ jobId: job.id, tenantId: ctx.tenant.id, resultKey: key, resultUrl: url, round: nextRound });
  return { url, key };
}
// density branch symmetric; else existing generateEditedImage path.
```
Reuses deduct/refund/partial/status untouched. No-op guard skipped (never calls
`generateEditedImage`). Credits unchanged.

---

## DECISIONS — RULED & LOCKED by the Architect (at `7c36d8f`)

**D-A. Combined controls → (b) REJECT-WITH-MESSAGE, scoped to the live flag.**
A job that includes scale or density alongside any other edit is rejected with a
`BAD_REQUEST` ("Scale/Density can't yet combine with other edits — run them
separately"), but **only when the live flag is on AND the provider is rasterReady**
— it is pre-deduct validation, so no credit is touched and a flag-off prod is
unchanged. Option (a) was rejected (it re-introduces the paid no-op via the broken
prompt path); option (c) deterministic chaining is the flagged follow-up enhancement.
*Wired above in the route gate (the two pre-deduct `throw new TRPCError` guards).*

**D-B. rasterReady-false → FALL BACK, NOT SILENT.** If a `*_LIVE` flag is on but the
provider isn't rasterReady (misconfig / SAM2 down), fall back to the existing prompt
path **and WARN** so the deploy misconfig is observable. The ops WARN line includes
the **job id + org_id** (`job=${job.id} org=${ctx.tenant.id}`). A flag/provider
mismatch must not fail user jobs, but it must not be silent either.
*Wired above as the `console.warn` in the route gate.*

**D-C. Instance-quality guard = no-op-billing guard.** The degenerate-mask case is
covered by the existing refund path: the helper THROWS on passthrough so no paid
no-op ships. **Density floor** (`r.removed === 0` → throw) ships **now** — it covers
0 instances and `removeN === 0`. **Scale floor** (empty fabric raster → throw) ships
now. The absurdly-many-instances **ceiling** is deferred until real SAM2/S5 data
exists for the Architect to set the bound. *Wired above in both helpers.*

**D-D. Pricing — UNCHANGED, AGREED.** `computeCredits` stays as-is (as A2 did);
deterministic credit cost is revisited as a separate decision once all three ops are
live. No pricing change in either route.

---

## Tests (per route, vitest, synthetic, no network)
- `generateScaledImage` / `generateThinnedImage` helper tests: mock
  `getMaskProvider` (+ `getInstanceMasks`), the op, and storage; assert the op is
  called with the resolved url + params and the PNG is returned (mirror
  `recolorLive.test.ts`).
- Route-decision unit: `scaleOnly`/`densityOnly` + `rasterReady` gating, and the
  combined-control decision (per D-A ruling).
- Real-garment eval (separate, credentialed): `scaleMetrics` / `densityMetrics`
  against a SAM2 truth mask on Frank's samples — the go-live gate per route.

## Acceptance (per the A2 template)
- `STUDIO_SCALE_LIVE` / `STUDIO_DENSITY_LIVE` default OFF: prod unchanged on land.
- Scale-only / density-only + flag on + rasterReady → deterministic op, one stored
  result, existing credit/refund intact, no-op guard skipped.
- Not rasterReady, or combined per D-A → defined fallback/rejection.
- Touched files edited surgically (Rule 6); helper + route tests green.
- Land dark; Architect verifies at SHA; Frank holds each flag flip; real-garment
  eval passes before flip.

---

## Gating summary
1. SAM2 privacy gate (Manus) — **the blocker**.
2. Architect: `sam2Provider` review + rule D-A..D-D → issue the locked
   scale-live / density-live prompts.
3. Builder: wire each to the prompt; helper + route tests; land dark.
4. Real-garment eval per route → Frank flips the flag.
