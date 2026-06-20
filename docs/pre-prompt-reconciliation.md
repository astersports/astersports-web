# Pre-prompt reconciliation — duplication pulled in by the merge

**Date:** 2026-06-20 · **Branch tip:** `adbf12a` · **Author:** Builder · **For:** Architect (to pin the locked scale/density prompts)

The merge of `origin/main` brought in two Manus-authored modules that **duplicate**
paths already covered behind the mask seam. Per the Architect status, these must be
reconciled **before** the locked scale/density prompts so the prompt wires the right
path. Findings below are from reading the code at `adbf12a`.

## Exposure check (done)
`hybridScale.ts` and `replicateClient.ts` are imported only by their own tests, the
audit doc, and `todo.md`. **Neither is imported by `server/routers/studio.ts` or
`server/aiEngine.ts`** — confirmed unwired, no money-path exposure. Reconciliation is
cleanup, not a live fix.

---

## Duplicate 1 — two Replicate clients
| | `server/replicateClient.ts` (Manus, verified) | `server/_core/masking/replicateSam2.ts` (the seam) |
|---|---|---|
| Transport | `replicate` SDK `replicate.run(...)` | raw predictions REST + poll |
| Model id | **`meta/sam-2`** (slug, no version pin) | `ENV.replicateSam2Model` (a version id — unset) |
| Mode used | **auto only** (`points_per_side` grid) | `boxMask` (box input) + `autoMasks` |
| Output parse | `{ combined_mask, individual_masks }` | tolerant extractor (already handles that shape) |
| Image input | **hosted public URL** | base64 **data-URL** crop |

**VERIFIED by the Architect's read:** model = `meta/sam-2`; auto-mask output =
`{ combined_mask: string, individual_masks: string[] }` — matches the seam's tolerant
extractor. The **density** instance-mask shape is therefore verified.

**STILL OPEN (and how to close by design, no new live verification needed):**
1. **Box-prompt input is unverified** — Manus's working client only ever ran *auto*
   mode; the `box` input to `meta/sam-2` was never exercised. But `getFabricMask`
   already sends a **degenerate box covering the whole crop** (`[0,0,cropW,cropH]`)
   because the crop *is* the fabric region. → **Recommendation: drop the box-prompt;
   take the largest auto-mask of the crop** for the fabric raster. This reuses the
   one verified path (auto mode) and removes the unverified `box` input entirely.
2. **Data-URL vs hosted-URL input is unverified** — the gate sends a base64 data-URL
   crop; the verified client sends a hosted URL. → **Recommendation: upload the crop
   to a short-lived signed URL** (crop-only = still privacy-minimized per Req 1) and
   send that, reusing the verified hosted-URL path. Avoids betting on data-URL support.

> Net: both open items collapse onto the **already-verified auto-mode + hosted-URL**
> path. No live Replicate re-verification required to proceed — only an Architect
> ruling to adopt largest-auto-mask + signed-crop-URL.

**Canonical client (recommendation):** keep the `Sam2Client` **seam** in
`replicateSam2.ts` (it's what `sam2Provider` depends on), and port the verified bits
**into** it: the `meta/sam-2` slug, the `points_per_side` auto params, the
`{ combined_mask, individual_masks }` parse, and the SDK `replicate.run` call. Then
delete `replicateClient.ts`.

---

## Duplicate 2 — two scale pipelines
`hybridScale.ts` (507 lines) is the **per-motif resize** approach (segment each motif
→ resize within its bbox → fill gaps → optional AI polish). This is the **rejected
architecture** — the Architect ruled scale = **print-repeat resample with mirror-tile**
(`server/_core/studio/ops/scaleRepeat.ts`), not per-motif.

**Recommendation: KEEP `scaleRepeat.ts`, retire `hybridScale.ts`** after harvesting:
- SAM2 tuning for dense prints: `pointsPerSide: 64, predIouThresh: 0.82,
  stabilityScoreThresh: 0.88, useM2M: true` (vs the verified client's 0.86/0.92) —
  a tuning data point for density's `autoMasks`.
- Guards: `MIN_MOTIF_AREA_PX = 200` (area floor — `instancesFromMasks` already filters)
  and `MAX_MASKS_TO_PROCESS = 80` (instance **ceiling** — directly informs the D-C
  "absurdly-many-instances" bound the Architect deferred).

---

## Proposed reconciliation commit (one PR change, pending Architect ruling + Frank's go)
1. Port the verified bits into `replicateSam2.ts`'s `Sam2Client`; adopt
   **largest-auto-mask** for `getFabricMask` and **signed-crop-URL** for the image
   input (closes both open items by design).
2. Delete `replicateClient.ts` and `hybridScale.ts` (+ their tests), after recording
   the harvested tuning/guards in the density prompt inputs.
3. Set the D-C instance ceiling from `MAX_MASKS_TO_PROCESS = 80` (Architect to confirm).

**Then** the Architect writes the locked scale + density prompts, pinned to the
reconciled client + verified shapes, folding D-A..D-D + R2 audit-context + the
R4-provisioning `rasterReady` rule. Build dark → real-garment eval per route → Frank
flips each flag.

## Holds before I execute
- Deleting `hybridScale.ts` / `replicateClient.ts` is **Manus's code** — awaiting
  Frank's explicit go to retire it.
- Adopting largest-auto-mask + signed-crop-URL is an **Architect ruling** (it changes
  `getFabricMask`'s strategy and touches the privacy-minimization story).
