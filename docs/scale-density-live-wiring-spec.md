# Scale-live / Density-live router wiring — Builder draft spec

**Date:** 2026-06-20 · **Branch:** `claude/jolly-pascal-k9tw4r` · **Status:** DRAFT for the Architect to finalize.
**Not buildable yet.** Both routes are Rule 19 money-path changes and depend on SAM2 being live, which is gated on the privacy work (4 requirements + the `sam2Provider` review at `005260c`). This draft gives the Architect a head start; the Architect issues the locked prompts and Frank GOes each before build.

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
  const { data } = await scalePrintRepeat({ image: { url: srcUrl }, fabric, targetFraction: params.targetFraction });
  return encodePng(data, fabric);   // scalePrintRepeat returns raw RGBA -> PNG for storage
}

export async function generateThinnedImage(
  originalImageUrl: string, params: { percent: number }
): Promise<Buffer> {
  const srcUrl = resolveSigned(originalImageUrl);
  const provider = getMaskProvider();
  const fabric = await provider.getFabricMask({ url: srcUrl });            // SAM2 raster
  const instances = await provider.getInstanceMasks({ url: srcUrl }, fabric); // SAM2 instances
  const { data } = await densityThin({ image: { url: srcUrl }, fabric, instances, percent: params.percent });
  return encodePng(data, fabric);
}
```
NB: `scalePrintRepeat`/`densityThin` return **raw RGBA** (`{data,width,height}`),
not PNG — the helper must `sharp(...).png()` before `storagePut`. (Recolor's
`separationRemap` returns PNG already; this is the one shape difference.)

---

## Route gate inside `generate` (after controls validation)

```ts
const scaleOnly   = controls.scale.enabled   && !recolor && !density && !remove && controls.scale.percent !== 0;
const densityOnly = controls.density.enabled && !recolor && !scale   && !remove && controls.density.percent > 0;
const rasterReady = getMaskProvider().rasterReady;
const useDeterministicScale   = ENV.studioScaleLive   && scaleOnly   && rasterReady;
const useDeterministicDensity = ENV.studioDensityLive && densityOnly && rasterReady;
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

## OPEN DECISIONS for the Architect

**D-A. Combined controls (the report's "❌ not done").** The deterministic ops are
single-purpose; a job with scale+recolor (etc.) can't run one op. Options:
- **(a) Combined → existing prompt path** (consistent with A2's recolor-only gate).
  Simplest. BUT the prompt path is broken for scale/density, so a combined job that
  *includes* scale or density gets a no-op on those controls → the no-op guard
  refunds and fails the job. Net: combined-with-scale/density effectively can't
  succeed until chaining lands. *(Builder lean for v1, with a clear message.)*
- **(b) Reject combined-with-scale/density** with a BAD_REQUEST ("Scale/Density
  can't yet combine with other edits — run them separately") until chaining lands.
  Most honest UX; no silent refund.
- **(c) Deterministic chaining** (recolor→scale→density, threading the intermediate
  image + recomputing masks). Best-in-class, real build. Deferred enhancement.

  *Builder recommendation: (b) for v1* (honest, no surprise refund), with (c) as the
  flagged follow-up. (a) risks the exact "paid no-op" we just removed.

**D-B. rasterReady-false behavior.** If a `*_LIVE` flag is on but the provider isn't
rasterReady (misconfig / SAM2 down), fall back to the prompt path (recommended) vs
BAD_REQUEST. Builder lean: **silent fall-back** — a flag/provider mismatch
shouldn't fail user jobs.

**D-C. Density instance-quality guard.** SAM2 auto-masks on real prints are
unvalidated. If `getInstanceMasks` returns 0 (or absurdly many) instances,
`densityThin` passthroughs (0) or over/under-removes. Add a sanity guard
(min/max instance count → fall back to prompt path or error)? Architect to set the
bounds once S5/real-garment data exists.

**D-D. Pricing.** Deterministic ops are ~free vs a generative call. Keep
`computeCredits` unchanged for now (as A2 did); revisit deterministic credit cost
as a separate decision once all three are live.

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
