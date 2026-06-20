# Print Studio — Comprehensive Audit: Color, Scale, Density

**Date:** 2026-06-20 · **Branch tip:** `403b1fb` (`claude/jolly-pascal-k9tw4r`, PR #1) · **Author:** Builder (Claude Code)
**For:** Architect + Manus · **Purpose:** full state-of-build + clean-code validation + next steps per axis.

**Evidence basis:** direct reads at `403b1fb`; `tsc --noEmit` run; full `vitest` run; grep sweeps for wiring, dead code, and TODOs. Where a fact rests on builder-side reporting rather than a live run (notably the SAM2 hosted path), it is marked **[UNVERIFIED-LIVE]**.

---

## 0. Executive summary

| Axis | Op | Eval metric | Eval runner | Live-wired? | Provider | Verdict |
|---|---|---|---|---|---|---|
| **Color (recolor)** | `separationRemap` ✅ | `metrics` ✅ | `recolorEval` ✅ | **YES — dark** (`STUDIO_RECOLOR_LIVE` off) | classical (no SAM2) | **Ready to flip** after A2 verify + smoke |
| **Scale** | `scaleRepeat`+`tile` ✅ | `scaleMetrics` ✅ | `scaleEval` ✅ | **No** | SAM2 (hard-req raster) | **Ready for live wiring** (blocked on SAM2 real) |
| **Density** | `densityThin`+`stratifiedSelect`+`infill` ✅ | `densityMetrics` ✅ | `densityEval`+`buildLabelMap` ✅ | **No** | SAM2 (hard-req raster+instances) | **Ready for live wiring** (blocked on SAM2 real) |

**Bottom line:** all three ops + eval gates + eval runners are implemented, deterministic, and green on the studio test suite. **Recolor is the only axis wired to the money path** (dark, classical, no SAM2 dependency). Scale and density are eval-complete but **not route-wired**, and both **hard-require a SAM2 fabric raster** that is not yet live-verified — that single dependency is the critical path.

---

## 1. Clean-code validation

| Check | Result |
|---|---|
| `tsc --noEmit` | **CLEAN** (0 errors) |
| Full `vitest` | **168 passed / 5 failed (173)** — all 5 failures are env/credential-presence checks (see below), none in color/scale/density |
| Studio/masking/eval subset | **fully green** (ops, metrics, runners, masking, privacy gate) |
| `TODO`/`FIXME`/`HACK`/`XXX` in `studio`+`masking` | **none** |
| ESLint | **no config present** — cannot run lint; recommend adding `eslint` for ongoing hygiene, or confirm it's intentionally out of scope |
| Determinism | all ops pure; `stratifiedSelect` RNG-free; `kmeans` seeded. **Residual:** cross-environment byte-stability depends on a pinned `sharp`/libvips (eval asserts determinism *within* an environment). Recommend pinning libvips for reproducible eval across machines. |

**The 5 failing tests (pre-existing infra, not this work):** `auth.logout`, `email` (RESEND_API_KEY), `owner-env` (VITE_OWNER_OPEN_ID), `replicate` (live REPLICATE_API_TOKEN auth), `webhook` (Stripe signature ×2). All are "is this secret configured / can we reach this live service" checks that fail in a secret-less sandbox.

**Dead-code / hygiene findings (low priority):**
- **Unwired eval flags.** `studioDeterministicRecolor`, `studioDeterministicScale`, `studioDeterministicDensity` are declared in `env.ts` but have **0 non-test references** — the eval runners run unconditionally when invoked, so these gates are inert. *Action: either gate the runners on them or remove them.* (The **live** flag `studioRecolorLive` IS used; `maskProvider` and `studioNoOpGuard` are used.)
- **`baseClothLab` in `scaleRepeat`** is accepted but unused — intentional forward-compat anchor for future boundary cleanup; documented in the op header. Keep or drop with the wiring decision.
- **Scale/density live flags absent** (`STUDIO_SCALE_LIVE`/`STUDIO_DENSITY_LIVE`) — expected; they land with the wiring.

**LOC (implementation, not tests):** ops 761, eval 1263, masking 720. Studio/masking/eval test LOC ≈ 1697.

---

## 2. COLOR — recolor (A1 op + A2 live)

### Status: **WIRED, DARK.** The only axis on the money path.

**Op** — `ops/separationRemap.ts` (144). Cluster-selects the source separation (k-means with tolerance from `coverage`), applies an L-preserving chroma/hue shift toward the target, thin fixed feather at the selection edge. Returns **PNG**. Throws on passthrough so the refund path fires (no paid no-op).

**Live wiring (A2)** — `aiEngine.generateRecoloredImage` → `getMaskProvider().getFabricMask` (**classical bbox**, no SAM2) → `separationRemap`. Routed in `routers/studio.ts` `generate` (lines 149–238):
- `recolorOnly` gate (recolor enabled, all other controls off) **and** `ENV.studioRecolorLive`.
- `fromColor` required (pre-deduct `BAD_REQUEST` if missing).
- Branches inside the existing `Promise.allSettled` → `generateRecoloredImage` → `storagePut` → `addVariation`. Reuses deduct/refund/status untouched; no-op guard skipped (deterministic op always applies or throws).

**Eval** — `eval/metrics.ts` (171) + `eval/recolorEval.ts` (198) runner. `verdict.pass = target && lum && offFab`; background bleed (`offBg`) reported but **excluded** (the D1/mask signal). Real-garment pink→navy reported PASS.

**Tests** — `separationRemap.test`, `recolorEval.metrics.test`, `recolorLive.test` (helper resolves URL, runs remap, returns PNG). Green.

**Provider independence:** recolor runs on the **classical bbox** it was validated on — it carries **no SAM2 dependency** and is unaffected by the SAM2 gate.

**Gaps / next steps:**
1. **Architect:** verify A2 at `afac00a` (now in-branch).
2. **Frank:** one Chrome smoke test (EyeDropper `fromColor` → generate), then flip `STUDIO_RECOLOR_LIVE=true`. Leave `STUDIO_MASK_PROVIDER=classical`.
3. *(reminder)* flipping the flag is a no-op unless `fromColor` reaches the op — it now does (UI picker → schema → helper).

---

## 3. SCALE (`scaleRepeat.ts` + `tile.ts`)

### Status: **eval-complete; NOT route-wired.**

**Algorithm** — resample the print by `targetFraction = (100+percent)/100` with lanczos3; composite **inside the fabric raster** (not the bbox, so a real silhouette excludes background); on shrink, mirror-tile (`tile.ts`: 4 oriented variants, reflect alternate rows/cols) to refill the freed gap; on enlarge, center-crop back. **Requires `fabric.raster`** (throws without). Empty raster → passthrough. Returns **RAW RGBA** `{data,width,height}`.

**Eval** — `eval/scaleMetrics.ts` (249). Primary estimator = biased-autocorrelation repeat **period**; **area-ratio fallback** when `periodConfidence < 0.2` (needs instance areas). `verdict.pass = scaleRatioError≤0.15 && paletteDeltaE≤5`; `poseBgDeltaE≤2` reported, **excluded**. Runner `eval/scaleEval.ts` (118) — offline, fabric mask from file = op raster + metric truth.

**Tests** — `scaleRepeat.test` (shrink/enlarge/passthrough/notch/determinism/missing-raster), `scaleMetrics.test`, `evalRunners.test` (synthetic, deterministic + palette-preserved). Green.

**Risks / scope (carried from the Architect):**
- **[FLAG] Non-repeat / placed graphics.** Mirror-tile is correct for a *repeating* textile print (stated scope) but **duplicates** a single placed graphic across the freed gap. No op-side periodicity guard (the period estimator lives only in the eval). **The wiring prompt should add an op-side repeat-vs-placed guard or a warn** so a logo isn't silently duplicated.
- **[DEFER]** on-body drape/fold (flat-lay scaling); generative relight finish (separate deferred flag).

**Blocking chain:** SAM2 real (fabric raster) → D-A..D-D route wiring → real-garment scale eval → flip.

---

## 4. DENSITY (`densityThin.ts` + `stratifiedSelect.ts` + `infill.ts`)

### Status: **eval-complete; NOT route-wired.**

**Algorithm** — `removeN = round(n·percent/100)`, `percent` 0..90. Select `removeN` instances via `stratifiedSelect` (RNG-free grid round-robin, ties by index), erase each with `infillBaseCloth(flatten:true)`, **survivor-clip** the erase region (`dilate(2px) ∩ raster ∩ ¬survivors`) + post-infill byte-restore of survivor pixels. **Requires `fabric.raster` + `instances`** (throws without). Passthrough on `n===0 / removeN===0 / percent≤0`. Returns **RAW RGBA + `removed`**.

**Ruled deviations (both accepted, documented in the op header):**
1. `flatten:true` infill — plain L-preserving erase leaves a luminance ghost on opaque non-iso-luminant motifs (pink-on-black) → metric reads 0 removed. Flatten replaces L with base-cloth L.
2. ~2px dilation — the 1px feather otherwise under-erases round motifs.

**Eval** — `eval/densityMetrics.ts` (200). `verdict.pass = countError≤0.10 && survivorIntegrity≤2 && evenness≤1.5 && infillCleanliness≤2.5`; `bgDeltaE≤2` reported, **excluded**. (Note: the gate is stricter than the headline three — evenness + infillCleanliness are also in pass.) Runner `eval/densityEval.ts` (130) + `eval/buildLabelMap.ts` (SAM2 `individual_masks` → instance label-map PNG).

**Tests** — `densityThin.test` (count, survivor byte-identity, determinism, passthrough, missing-raster, survivor-clip regression), `densityMetrics.test`, `infill.test`, `evalRunners.test`, `buildLabelMap.test` (round-trip). Green.

**Risks / scope:**
- **[FLAG] Small-n granularity.** `round(n·pct/100)` is coarse for few motifs (n=3 @50% → 2 = 67% → countError 0.17 FAIL). Inherent to discrete removal; real prints have many motifs. Known floor.
- **[DEFER] Fold-shadow infill.** Single base-cloth L can read flatter than surrounding cloth on strong fold-shadow variation → deferred Option-2 local-L reconstruction; revisit on real data.
- **[DEFER] Instance ceiling.** `MAX_MASKS=80` is the **provisional** D-C ceiling (harvested) — eval-confirm; do **not** hard-reject (a dense print can legitimately exceed 80).

**Blocking chain:** SAM2 real (fabric raster + instance masks) → D-A..D-D route wiring → real-garment density eval → flip.

---

## 5. Shared substrate

**Masking seam** (`server/_core/masking/`):
- `types.ts` — the provider interface ops consume (never a specific model). `bbox` (today) vs `raster` (rasterReady). `MaskProviderUnavailableError` for fail-safe.
- `index.ts` — registry + **`withFailSafe`** wrapper: SAM2 failure degrades to classical, WARNs, returns `[]` instances. **[Architect-corrected]** the robust D-B/D-C split is at the **gate** (`rasterReady` reflects provisioning), not the helper — to be encoded in the locked prompts.
- `sam2Provider.ts` — privacy gate: crop-to-fabric, org_id audit log, full-image coordinate remap. **Reconciled:** one `autoSegment` call → fabric from `combined_mask` (provisional; exact selection rule pinned in the locked prompt + fabric-IoU eval), instances from `individual_masks`. Degenerate box-prompt dropped.
- `replicateSam2.ts` — `Sam2Client` ported from the retired verified client: `meta/sam-2` SDK, data-URL input, `{combined_mask, individual_masks}` parse. **[UNVERIFIED-LIVE]** — needs ONE real call (data-URL acceptance + auto path) before any flip.
- `classicalProvider.ts` (rasterReady:false floor), `locateFabricRegion.ts` (vision-LLM bbox), `sam2Mask.ts` (decode/instances), `image/decodeUpright.ts` (EXIF boundary).

**Privacy gate:** 4 requirements (crop-to-fabric, org_id logging, sub-processor disclosure, fail-safe) built by Manus, Architect-verified at `83559a42`, transferred byte-identical into this branch (`privacyGate.test.ts` present).

**Eval tooling:** `evalMaskIO` (offline mask loaders), `scaleEval`/`densityEval` runners, `buildLabelMap` (SAM2→label-map), `recolorEval`. All runnable offline against local sample garments.

**Env flags:** `maskProvider` (classical|sam2), `studioNoOpGuard`, `studioRecolorLive` (used); `studioDeterministic{Recolor,Scale,Density}` (declared, **unwired** — see §1); `replicateApiToken`/`replicateSam2Model`. **Missing:** `studioScaleLive`/`studioDensityLive` (land with wiring).

---

## 6. Capability / gap matrix

| Component | Recolor | Scale | Density |
|---|:--:|:--:|:--:|
| Deterministic op | ✅ | ✅ | ✅ |
| Eval metric module | ✅ | ✅ | ✅ |
| Eval runner (CLI) | ✅ | ✅ | ✅ |
| Live env flag | ✅ | ❌ | ❌ |
| `aiEngine` helper | ✅ | ❌ | ❌ |
| Route wiring in `generate` | ✅ | ❌ | ❌ |
| D-A combined reject | n/a | ❌ | ❌ |
| D-B rasterReady fallback+WARN | n/a | ❌ | ❌ |
| D-C no-op refund | ✅ (throws) | ❌ wiring | ❌ wiring |
| Real-garment eval pass | ✅ | ⏳ | ⏳ |
| Provider dependency | classical | **SAM2** | **SAM2** |

---

## 7. Risk register

| Risk | Sev | Owner | Mitigation |
|---|---|---|---|
| SAM2 hosted path unverified live (data-URL accept, auto shape) | **High** | Manus/Frank | one credentialed confirmation call; reconciled client is best-effort against the verified shape |
| SAM2 instance-segmentation quality on real garments | **High** | eval | run density real-garment eval before flip; D-B fallback prevents user-facing failure |
| Non-repeat placed graphic mirror-tiled | **Med** | wiring prompt | op-side repeat-vs-placed guard or warn |
| On-body drape treated as flat-lay | **Med** | v2 | generative relight finish (deferred, off by default) |
| Small-n density count granularity | **Low** | known floor | many-motif prints rarely hit it |
| Fold-shadow infill flatness | **Low** | eval-triggered | Option-2 local-L on real-data mismatch |
| Cross-env byte-determinism (libvips) | **Low** | infra | pin sharp/libvips version |
| Unwired eval flags / no eslint | **Low** | cleanup | wire-or-remove flags; add eslint |

---

## 8. Next steps by owner

**Architect**
1. Verify the reconciled SAM2 client at `fa1f6c4` (or `403b1fb`).
2. Verify A2 recolor at `afac00a`.
3. Issue the locked **scale-live** then **density-live** wiring prompts, pinned to: the reconciled client + the eval-confirmed fabric rule; D-A..D-D; R2 audit-context as a param; **R4 provisioning-aware `rasterReady`** (the corrected D-B/D-C gate); the scale non-repeat guard; the provisional `MAX_MASKS=80` ceiling.

**Manus / Frank (Replicate token holder)**
4. One real-garment **wire-shape confirmation call** (data-URL acceptance + auto path end-to-end) → closes the `[UNVERIFIED-LIVE]` item.
5. Run the eval runners on real garments (fabric mask + `buildLabelMap` for density).

**Builder (on the locked prompts)**
6. Add `STUDIO_SCALE_LIVE`/`STUDIO_DENSITY_LIVE`; `generateScaledImage`/`generateThinnedImage` helpers; route branches (D-A..D-D); land dark.
7. Cleanup pass (low priority, can fold into wiring): wire-or-remove the 3 unwired eval flags; decide `baseClothLab`; consider eslint.

**Frank**
8. Flip `STUDIO_RECOLOR_LIVE` now (after smoke); flip scale then density after each route's real-garment eval passes.

---

## 9. Open decisions for the Architect
- **Scale non-repeat guard:** op-side periodicity detection (warn vs reject vs route-to-prompt) for placed graphics.
- **Density instance ceiling:** confirm/tune the provisional `MAX_MASKS=80` against real instance counts.
- **Fabric-selection rule** over `combined_mask` (interior-restricted vs largest-connected-component) — pin + fabric-IoU validate.
- **Fold-shadow infill:** ship v1 flatten; gate Option-2 local-L on a real-data trigger.
- **Eval-flag cleanup:** wire `studioDeterministic*` into the runners or remove them.
