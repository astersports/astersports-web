# Print Studio — Decision Review (read before committing)

**Date:** 2026-06-19
**Repo:** github.com/astersports/astersports-web · **Branch:** `claude/jolly-pascal-k9tw4r` · **PR:** #1
**Author:** Builder lane (Claude Code, read-write). **Reviewers:** Architect lane (Claude.ai), Frank.
**Purpose:** consolidate everything needed to approve — or reject — the move from prompt-based editing to a deterministic-op + generative-finisher architecture for Scale / Density / Color-coding. **Nothing here commits spend or infra; this is the review gate.**

---

## 0. TL;DR

- **Diagnosis (high confidence):** Scale and Density fail because they are *global, deterministic* image operations handed to an instruction-tuned model that anchors to the source. Recolor/Remove survive because they are *local appearance* edits. This is architectural, not a prompt bug.
- **Already shipped, fully reversible (no commitment):** a Tier 0 hotfix that stops billing customers for no-op outputs (PR #1, feature-flagged).
- **The one real commitment on the table:** introducing a **segmentation capability** (masks). Everything best-in-class depends on it. It costs money, latency, and — critically — means **customer print art leaving our cloud** unless self-hosted.
- **Recommendation:** approve a **time-boxed spike week** to de-risk 4 unverified assumptions *before* committing to segmentation hosting or the full rebuild. The spikes are cheap; the commitments they inform are not.
- **5 decisions** are listed in §9. Three need Frank (money/infra/IP); two are spec confirmations for the Architect.

---

## 1. Current state — verified against the code

| Area | Fact | Source |
|---|---|---|
| Edit API | `images.v1.ImageService/GenerateImage`, body `{prompt, original_images[]}`, each image `{url?, b64Json?, mimeType?}`. **No mask channel, no inpaint region.** | `_core/imageGeneration.ts:65` |
| Edit API transport | Sends `connect-protocol-version: 1` → **Connect RPC**; may reject unknown JSON fields (matters for adding `seed`). | `_core/imageGeneration.ts:62` |
| Image model | **Not pinned** — no `model` field sent; defaults to forge.manus.im. Identity/quality unknown. | `generateImage()` |
| Vision | OpenAI-compatible `invokeLLM`, accepts images, returns text/JSON (strict schema). **Cannot emit pixel masks.** | `_core/llm.ts`, `aiEngine.ts:47` |
| Detection | `detectPrintElements` → 3–10 free-text motif names, **no spatial grounding** (no boxes/masks). | `aiEngine.ts:39` |
| Raster libs | **None installed** (no sharp/jimp/canvas). pnpm@10 (blocks build scripts by default), esbuild `--packages=external`. | `package.json` |
| Controls | scale −50..50, density 0..90, remove 0..100, recolor coverage 10..100; all four wired in the client. | `shared/controls.ts:46`, `ControlPanel.tsx` |
| Variations | Parked to 1 at router + UI "until quality validation is added." | `studio.ts:115`, `ControlPanel.tsx:44` |
| Economics | Starter $39/3,900cr · Pro $199/19,900cr · Team $20/seat/2,000cr · trial 150cr/7d. Cost: standard 10, combined 15, extra-variation 10, highRes 5. | `shared/billing.ts` |

**Product status, plainly:** 2 of 4 controls (Recolor, Remove) are usable; 2 (Scale, Density) return output identical to input. The fix for the broken two is architectural.

---

## 2. Root cause (high confidence)

Instruction-tuned image editors are trained mostly on *local appearance edits* and **anchor hard to the source image** — which is exactly why Recolor/Remove preserve garment pose so well. Scale requires deviating from the source at *every fabric pixel*; Density requires *counting* instances and deleting a precise fraction. Both are out-of-distribution for this model class, so it resolves the tension by copying the input. No prompt reliably fixes a capability gap.

---

## 3. Already shipped — Tier 0 hotfix (reversible, no commitment)

In PR #1, behind flag `STUDIO_NOOP_GUARD` (default on):

- Removed the prompt's *"return the image unchanged"* escape hatch (it was literally instructing the model to produce the billable no-op).
- Added a **vision-LLM no-op guard**: after generation, verify the requested change is visible vs the original; retry once; else throw → the **existing refund path returns the customer's credits** instead of billing a no-op. **Fails open** (a judge error never blocks a real result).
- `describeExpectedChange()` summarizes the requested change (and seeds the eval harness).

**Why a vision judge, not perceptual hashing:** hashing needs a raster lib (sharp) + pnpm build-script allowlisting; the judge needs **zero new dependencies** and doubles as the acceptance-metric foundation. Trade-off: adds one cheap vision call per generation and can occasionally misjudge — mitigated by requiring a confident "unchanged" verdict twice before refunding.

**This is the floor.** It makes the *broken* controls fail honestly (refund) instead of charging for nothing. It does **not** make Scale/Density *work* — that needs §5.

---

## 4. Proposed architecture (the thing to approve)

Invert the roles. Today the generative model is the editor. Instead:

```
1. ISOLATE   — get a precise mask of the printed-fabric region
2. OPERATE   — do the edit deterministically on pixels (scale / density / recolor)
3. COMPOSITE — warp the edited pattern back into the mask, following drape via luminance displacement
4. FINISH    — ONE generative pass only to relight + blend seams (often skippable for recolor)
```

The generative model becomes the *finisher*, not the editor. This raises quality **and** margin (deterministic ops are cheap; fewer/cheaper generation calls).

---

## 5. The load-bearing dependency: SEGMENTATION

Masks are the prerequisite for all three controls. Forge has no segmentation model; the vision LLM cannot produce masks (verified). So we must add one. **This is the only decision that commits real money, infra, and customer-data exposure.**

### Options

| Option | Quality | Latency / cost | Customer-IP / privacy | Verdict |
|---|---|---|---|---|
| **Hosted SAM2** (fal.ai / Replicate), box-prompted by the vision LLM | Best, general (flat-lay/hanging/on-body) | ~1–3s + per-call fee (confirm current pricing) | ⚠️ **Customer print art leaves our cloud** → needs DPA / privacy review | Fastest to ship; privacy is the catch |
| **Self-hosted SAM2** (Modal / own GPU) | Same model, controllable | Higher fixed cost, you own ops | ✅ Data stays in our boundary | Best for a sellable design tool if budget allows |
| **Clothing parser** (SCHP / U2Net cloth-seg) | Good for garment region, weaker for arbitrary prints | Similar | Same as chosen host | Narrower than SAM2 |
| **Classical CV** (vision box + GrabCut / color-seg via sharp) | Fragile on draped/busy prints | Cheap, no GPU | ✅ Local | Acceptable **interim** mask only, not the product floor |

**Builder recommendation:** **self-hosted SAM2** (or a privacy-reviewed hosted SAM2) prompted by a vision-LLM bounding box. The box→mask hybrid is the current standard. Decide hosting **with customer-IP in mind** — design firms will ask "does our art leave your cloud?"

---

## 6. Unverified assumptions — spike BEFORE committing

These are cheap to test and each one gates a spend/scope decision. **Do these first.**

| # | Assumption | Why it matters | Spike (cost) |
|---|---|---|---|
| S1 | Forge `GenerateImage` honors a **second reference image** | Determines whether the no-segmentation swatch fallback (and reference-guided finish) is viable | Send `[garment, obviously-different-swatch]`; eyeball output (~½ day) |
| S2 | Endpoint accepts a **`seed`** field without erroring | Determinism is a must for a design tool; but Connect RPC may reject unknown fields and **break all generation** | Send one request with `seed`; confirm 200 + reproducibility (~½ day) |
| S3 | **`sharp`** installs/loads in the deploy runtime under pnpm@10 | All deterministic pixel ops depend on it; pnpm@10 blocks native build scripts by default | Add sharp, allowlist build, run a resize in the deploy image (~½ day) |
| S4 | Pinned **image-model identity & quality** (`/v1/models`) | Quality of the generative finish pass (§4 step 4) is capped by this model | Call `/v1/models`; test a known edit (~½ day) |
| S5 | **Segmentation quality** on real garments (flat-lay vs hanging vs on-body) | Determines whether masks are production-grade or need fallbacks | Run SAM2 on ~10 representative photos (~1 day, after D1) |

**A spike week answers S1–S4 and the cheapest read on S5 — without committing to hosting or a rebuild.**

---

## 7. Per-control rebuild specs (condensed; full specs follow per phase)

**🎨 Recolor / color-coding — build first (highest ROI, deterministic, the named feature).**
Two modes: (a) **separation remap** — k-means/median-cut on masked pixels → named ink "separations" the designer can remap; (b) **per-element-mask recolor** — LAB hue/chroma shift inside the element mask, **luminance preserved** (reads as a dye-lot change, not a flat overlay) for continuous-tone prints. Add a **ΔE acceptance gate** + **protected-color lock list** + **saveable/exportable colorways**. Often needs *zero* generation calls.

**📐 Scale — build second.**
Mask → extract representative patch (rigorously: detect repeat lattice via FFT autocorrelation; pragmatically: resample a clean patch) → resample to exact target (`targetPct = 100 + percent`) → composite into mask, **displacement-warped by fabric luminance** to follow folds → generative relight. The swatch spec (`docs/scale-hybrid-plan.md`) is the **no-segmentation fallback**, quality-capped, behind the flag.

**🔢 Density — build third (hardest).**
Mask → localize instances via **template-matching / SAM2 auto-masks** (NOT LLM centroids — same counting weakness that breaks density today) → select X% evenly → erase + infill with sampled inter-motif ground color (generative infill only for large/busy gaps). Now "delete 30%" is *real and verifiable*.

---

## 8. Economics

Moving work off the generative model is a **margin win, not just quality**:
- Deterministic recolor → ~0 generation calls (one amortized seg call/job).
- Scale → one bounded relight pass instead of "regenerate until it changes."
- Opportunity: a **pricing tier** where deterministic edits (recolor, exact scale) are cheaper than free-form generative edits — better unit economics *and* a clearer product story.

Net new cost: the segmentation call (per-job, cacheable) + (if hosted) third-party fees. The Tier 0 guard also adds one cheap vision call/job; it pays for itself by eliminating refundable no-ops and chargebacks.

---

## 9. Decisions required

| # | Decision | Owner | Builder recommendation | Consequence if "no" |
|---|---|---|---|---|
| **D1** | Approve a segmentation dependency **and its hosting model** (self-host vs hosted vs classical interim), with customer-IP/privacy resolved | Frank | **Yes — self-hosted/privacy-reviewed SAM2** | Scale/Density stay capped at prompt+swatch quality; grounded recolor impossible |
| **D2** | Pin & own the Forge image-model quality (`/v1/models`); budget a stronger endpoint if the finish pass is weak | Frank | Run it in the spike week | Finish-pass quality is an unknown ceiling |
| **D3** | Confirm build order recolor → scale → density | Frank/Architect | Agree | — |
| **D4** | Authorize the **spike week** (S1–S4, cheap read on S5) before any spend | Frank | **Yes — do this next** | Commit blind to hosting/rebuild |
| **D5** | Confirm spec refinements: dual-mode recolor; template-match density; keep swatch as long-term fallback; eval thresholds owned by Architect | Architect | As written in §5/§7 | Rework risk mid-build |

---

## 10. Proposed sequencing

**Now (no new spend; needs only D4):**
1. Spike week → S1–S4 + cheap S5 read. Output: a one-page go/no-go with measured results.
2. Architect formalizes eval-harness acceptance thresholds (builds on the Tier 0 judge).

**After D1 (segmentation approved):**
3. Vision-box → SAM2 mask + per-job mask cache + fallback ladder.
4. Phase A: deterministic Recolor v2 (dual-mode + ΔE + lock + colorways). **Ship — biggest visible jump.**
5. Phase B: Scale (composite + relight; swatch fallback).
6. Phase C: Density (template-match localization + erase/infill).

**Cross-cutting:** every new path feature-flagged; credits/refunds/job-status preserved; reprice deterministic ops once they drop the generation call.

---

## 11. Explicitly out of scope / not proposed

- No change to billing plans or Stripe wiring in this work.
- No unparking of variations until the eval harness gives acceptance numbers (`studio.ts:115`).
- No speculative `seed` field until S2 confirms the endpoint won't reject it (Connect RPC risk).
- No deletion of the swatch fallback — it stays as the offline/degraded path.

---

## 12. Open questions for the Architect

1. Eval harness: confirm Builder ships the skeleton (done via the Tier 0 judge) and Architect owns the threshold definitions?
2. Recolor: confirm dual-mode (separation + per-element mask) — it changes the Phase A surface area.
3. Density: confirm template-match / auto-mask as primary localizer over LLM centroids?
4. Segmentation hosting: any constraint we should bake into D1 framing for Frank (budget ceiling, data-residency requirement)?
5. Is a spike week (D4) the right gate, or do you want S1–S4 split across separate go/no-go PRs?

---

*Companion docs in `docs/`: `scale-hybrid-plan.md`/`.txt` (swatch fallback spec), `collaboration-next-steps.md` (lane working agreement). Tier 0 hotfix is in PR #1.*
