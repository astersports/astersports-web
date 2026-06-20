# ESCALATION — SAM2 client fork: confirmed-old vs blessed-reconciled

**Date:** 2026-06-20 · **For:** Architect (ruling needed) · **Raised by:** Builder
**Trees:** `main` = `05b5acc` (Manus) · PR #1 = `59365ed` (`claude/jolly-pascal-k9tw4r`)

## TL;DR
Manus's real-garment confirmation PASSED (66 instances, 0.0% density count error) — but it ran against **`main`'s OLD SAM2 client**, which is the implementation the Architect explicitly **ruled against** in the pre-prompt reconciliation. The **Architect-blessed reconciled client** (PR #1, `fa1f6c4`) is **not** what was confirmed. Only one client ships. **Architect ruling required.**

## The two clients

| | **Confirmed (main, `05b5acc`)** | **Blessed (PR #1, `fa1f6c4`)** |
|---|---|---|
| Interface | `boxMask` + `autoMasks` (**two** calls) | `autoSegment` (**one** call) |
| Fabric source | SAM2 **box-prompt** (`[0,0,cropW,cropH]`) | `combined_mask` from the auto call |
| Transport | raw `/v1/predictions` API (`version` field) | `replicate` **SDK** `run()` |
| Model id handling | bare version hash works (predictions `version`) | needs `meta/sam-2:<hash>` (fixed: `resolveModelRef`, `59365ed`) |
| Live-confirmed? | ✅ **the 66-instance PASS ran on this** | ❌ never run live |
| Architect ruling | ruled **against** (drop box-prompt; single call; `combined_mask`) | the ruled design |

## Why this is a real contradiction
The Architect's reconciliation ruling (docs/pre-prompt-reconciliation.md) was explicit: **drop the degenerate box-prompt** (never exercised on `meta/sam-2`), **one `autoSegment` call** (eliminates the double SAM2 call on density), **fabric from `combined_mask`** (rule pinned after an IoU). Manus did not take the reconciliation; they kept the old two-call box-prompt client and **confirmed that one**.

So: the confirmed path is the one ruled against; the blessed path is unconfirmed.

## What the PASS does and does NOT validate
- **DOES:** SAM2 segments this garment well (66 distinct motifs, not one blob); data-URL crops are accepted; the deterministic density op + stratified selection give 0.0% count error. **The op/eval layer is validated regardless of client.**
- **Does NOT:** validate the reconciled client; and validates fabric-mask *quality* only weakly — density barely uses the fabric raster (instances drive selection; fabric only bounds + samples ground). **Scale** depends heavily on fabric-raster quality, and **neither** `combined_mask` (reconciled) **nor** box-prompt (old) fabric has an IoU vs the truth mask yet. The Architect's Decision-3 IoU is still open for the scale path.

## Options for the Architect
- **A — Keep reconciled, re-confirm (Builder lean).** Ship the blessed client; Manus runs one more confirmation call against `autoSegment`/`combined_mask` (+ report the fabric IoU vs the skirt truth mask, closing Decision 3). Keeps the ruled benefits: no unverified box-prompt, **half** the SAM2 calls/latency on density, single segmentation feeding both fabric + instances. Cost: one more credentialed run.
- **B — Keep confirmed old client.** Ship what passed; revert the reconciliation on PR #1; rewire scale-live to the old `getFabricMask` (box-prompt). Pragmatic (already validated) but overrides the reconciliation ruling and keeps the double SAM2 call on density.
- **C — Hybrid.** Keep the old client's box-prompt fabric (validated) but adopt the single-call structure / SDK transport from the reconciled client. More work; best-of-both only if the IoU says box-prompt fabric beats `combined_mask`.

## Coupled decision — duplicate eval runners
Both trees built `scaleEval.ts`/`densityEval.ts` independently (main: 237/354 LOC + a synthetic generator; PR #1: 118/130 LOC + `evalMaskIO` + `buildLabelMap`). One set should win. Recommend the Architect pick the canonical pair when ruling the client (they're coupled — the runners consume the provider).

## Consolidation direction (Frank, already decided)
**Consolidate on `main`** (deployed/confirmed line); close PR #1. Most of PR #1's unique value is gated on this ruling:
- **Unblocked now:** sharp pin (`2beaf3f`), this audit/escalation, and the comprehensive audit doc.
- **Gated on the client ruling:** the reconciled client (`fa1f6c4`) + `resolveModelRef` (`59365ed`); scale-live's final `getFabricMask` target; the eval-runner dedup.

**Ask of the Architect:** rule the client (A/B/C) + pick the canonical eval-runner pair. Then the consolidation onto `main` is mechanical.
