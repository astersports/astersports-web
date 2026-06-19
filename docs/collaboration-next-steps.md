# Print Studio — Collaboration & Next Steps (Builder ↔ Architect)

**Date:** 2026-06-19
**Repo:** github.com/astersports/astersports-web · **Branch:** `claude/jolly-pascal-k9tw4r`
**Lanes:** Architect = Claude.ai (read-only GitHub, specs/decisions). Builder = Claude Code (read-write, PRs). Executor = Manus (per spec).
**Re:** "PRINT STUDIO — BEST-IN-CLASS ARCHITECTURE FOR SCALE / DENSITY / COLOR CODING" (Architect, 2026-06-19)

---

## 0. Verdict

**Endorsed.** The Builder lane independently reached the same conclusion: this is an architecture problem, not a prompt problem — invert the roles so deterministic pixel ops do the edit and the generative model only finishes (re-drape / relight / blend). Segmentation is the load-bearing dependency. No disagreement on the thesis or the three per-control specs.

This document does three things:
1. Confirms the Architect's facts against the actual code (Builder has read-write access).
2. Adds **one urgent gap the read-only lane could not see operationally** + two ship-now fixes that are independent of the big decisions.
3. Proposes a concrete collaboration model and sequenced next steps so CC/Manus can start *today* without waiting on D1–D3.

---

## 1. Verification log (Builder re-checked against code)

| Architect claim | Status | Note |
|---|---|---|
| GenerateImage takes `{prompt, original_images[]}`, no mask channel | ✅ confirmed | `_core/imageGeneration.ts:65` |
| Image model id not pinned | ✅ confirmed | `generateImage` sends no `model`; defaults to forge.manus.im |
| Vision LLM = text/JSON only, no masks | ✅ confirmed | `_core/llm.ts`, `aiEngine.ts:47` |
| `detectPrintElements` returns 3–10 free-text names, no grounding | ✅ confirmed | `aiEngine.ts:39` |
| No raster lib; pnpm@10; esbuild `--packages=external` | ✅ confirmed | `package.json` |
| Control ranges −50..50 / 0..90 / 0..100 / 10..100 | ✅ confirmed | `shared/controls.ts:46-53` |
| Economics: Starter $39/3900, Pro $199/19900, Team $20/seat/2000; cost 10/15/10 | ✅ confirmed | `shared/billing.ts` (trial = 150cr/7d) |
| Variations parked to 1 at router + UI | ✅ confirmed | `studio.ts:115`, `ControlPanel.tsx:44` |
| "recolor wired despite stale comment" | ⚠️ minor correction | Recolor is fully wired; the parked comment is about **variations**, not recolor. No contradicting comment exists. |

---

## 2. Strong agreements (no further discussion needed)

- Deterministic-op + generative-finisher architecture (Architect §2).
- Segmentation as the gating dependency; SAM2 box-prompted by the vision LLM (Architect §3).
- Build order **recolor → scale → density** (Architect §6).
- Margin upside from moving work off the generative call (Architect §7).
- Demote the reference-swatch scale spec (PR #1) to the no-segmentation fallback; still run its Phase 0 image-2 gate to calibrate trust in the generative cleanup pass (Architect §8).

---

## 3. Builder additions — what to add to the Architect plan

### 3A. 🔴 URGENT, INDEPENDENT OF D1–D3: you are billing customers for no-op outputs
The Architect plan starts at the big architecture decision. But there is a **commercial liability shippable today** that needs no segmentation and no decisions:

- `controls.ts:237` literally instructs the model to **"return the image unchanged"** when it can't edit.
- `generateEditedImage` (`aiEngine.ts:149`) accepts **any** returned image as success — there is **no check that the output differs from the input**.
- The job is then **billed** (`studio.ts:260`) and only refunded on a thrown error (`studio.ts:225`), never on a silent no-op.

**Net:** today, Scale (and partial Density) charge real credits for output identical to the input. For a product you sell, that is a refund/chargeback generator and a trust problem. **This should ship as a hotfix regardless of the architecture roadmap.**

Fix (Tier 0, ~2–3 days, no new infra):
1. Remove the "return unchanged" escape hatch from the scale/density prompt paths in `buildInstruction`.
2. Add a **no-op guard** in `generateEditedImage`: perceptual-hash / SSIM compare output vs input; if effectively identical when a change was requested → auto-retry once, then **auto-refund** and surface a clear error instead of billing.

### 3B. Ship-now: determinism (seed)
`generateImage` sends no seed, so results are non-reproducible. A design tool must be reproducible. Thread an optional `seed` through `GenerateImageOptions` → request body, and persist it on the job. ~0.5 day. Independent of D1–D3.

### 3C. Make the eval harness a *gating deliverable*, not cross-cutting nice-to-have
The Architect lists feature-flags (good). Add an **acceptance-metric harness** as a first-class Phase A deliverable, because:
- It is the only way to *prove* "best-in-class" to a buyer (ΔE for recolor, motif-count delta for density, measured size-ratio for scale).
- It is the precondition to **unpark variations** (`studio.ts:115`) — they were parked "until quality validation is added." This closes that loop.

### 3D. New decision the read-only lane could not raise: customer-IP / privacy of third-party segmentation
SAM2 on fal.ai/Replicate means **sending customers' proprietary print designs to a third-party GPU host.** For a tool sold to design firms, that has contractual/IP/privacy implications (DPA, data residency, "your art leaves our cloud"). This must be a conscious decision, not a silent infra choice. Options: hosted (fastest), self-host SAM2 on Modal/own GPU (controllable, private), or classical-CV interim (no third party). → folded into D1 below.

---

## 4. Technical refinements to the per-control specs

**Recolor (§5.1) — handle two print types, not one.**
K-means "separations" assume a limited-ink flat print. Photographic/watercolor prints are continuous-tone where discrete separations are approximate. Best-in-class should offer **both modes**: (a) separation remap for flat prints, and (b) **per-element-mask recolor** (recolor the masked motif via LAB hue/chroma shift, luminance preserved) for continuous-tone. Add a **ΔE acceptance gate** + a **protected-color lock list** so one remap can't bleed into other separations. This is the flagship feature; over-spec it.

**Density (§5.3) — avoid LLM centroids as the primary localizer.**
Vision LLMs are unreliable at *exhaustive* instance localization/counting on dense ditsy prints (the same weakness that breaks count-by-prompt today). Prefer **template-matching (normalized cross-correlation)** of the extracted motif across the masked region, or **SAM2 automatic mask generation** for instances. Keep LLM centroids only as a coarse seed. Flag counting accuracy as the key risk to validate in the density eval.

**Scale (§5.2) — agree; two flags.**
(1) The displacement-warp-by-luminance trick is a good approximation but specular/shadow interaction still needs the generative relight pass — so Scale's quality is coupled to D2 (image-model strength). (2) Confirm the two-direction math (`targetPct = 100 + percent`) and the EXIF-orientation / coverage / edge-tiling bugs from the swatch spec are carried over.

---

## 5. Decisions required from Frank (consolidated)

| # | Decision | Builder recommendation |
|---|---|---|
| **D1** | Approve an external/segmentation dependency **and its hosting model** (hosted SAM2 vs self-host vs classical-CV interim), accounting for customer-IP/privacy (§3D) | **Yes — self-hosted or privacy-reviewed SAM2.** It gates best-in-class scale/density/grounded-recolor. Decide hosting with IP in mind. |
| **D2** | Own the Forge image-model quality (run `/v1/models`); budget a stronger endpoint if the cleanup pass is weak | Run it before Phase B Step 4; treat as a quality ceiling input |
| **D3** | Confirm build order recolor → scale → density | Agree |
| **D4** *(new)* | **Approve Tier 0 hotfix to ship now** (no-op guard + auto-refund + drop escape hatch + seed), independent of D1–D3 | **Yes, immediately** — it stops billing for no-ops |
| **D5** *(new)* | Make the eval harness a Phase A gating deliverable (and the trigger to unpark variations) | Agree |

D4/D5 need no architecture commitment and unblock work today.

---

## 6. Collaboration model (proposed working agreement)

- **Architect (Claude.ai, read-only):** owns specs, decision framing, and per-phase build prompts. Produces one spec per phase. Does not write code.
- **Builder (Claude Code, read-write):** implements one **PR per phase**, behind a feature flag; owns tests, eval harness, no-op guard, and verification notes in each PR. Reports measured acceptance metrics back to the Architect.
- **Executor (Manus):** runs spec'd, well-bounded tasks (e.g., the segmentation spike, the swatch builder) per the plain-text specs.
- **Frank:** owns D1–D5 and merges.
- **Cadence:** each phase = spec (Architect) → PR + metrics (Builder) → review/merge (Frank) → next spec. One PR at a time, always revertible via flag.
- **Artifacts live in `docs/`:** `scale-hybrid-plan.md/.txt` (swatch fallback) + this file; future phase specs land here too.

---

## 7. Sequenced next steps (with owners)

**Now — does not wait on D1–D3 (needs D4/D5):**
1. **Builder:** Tier 0 hotfix PR — no-op detection + auto-refund, remove escape hatch, add seed + persist. *(ship-now liability fix)*
2. **Builder:** eval-harness skeleton (ΔE, motif-count, size-ratio, no-op guard) on a small fixed test set. *(unparks variations)*
3. **Manus/Builder:** run the swatch spec's **Phase 0 image-2 gate** + `sharp` install check under pnpm@10 (allowlist build scripts). *(calibrates D2; verifies raster path)*
4. **Frank:** run `/v1/models`, record the image model (D2 input).

**After D1 (segmentation approved):**
5. **Builder:** stand up vision-box → SAM2 mask + per-job mask cache + fallback ladder.
6. **Builder:** Phase A — deterministic recolor v2 (separation + per-element LAB remap, ΔE gate, protected-color lock, colorways save/export). Ship.
7. **Builder:** Phase B — scale (pattern resample + displacement composite + generative relight; swatch path as fallback).
8. **Builder:** Phase C — density (template-match/auto-mask localization + erase/infill).

**Cross-cutting throughout:** feature-flag every new path; keep credits/refunds/job-status intact; reprice deterministic ops once they drop the generation call (margin win, §7 of Architect doc).

---

## 8. Open questions back to the Architect

1. Do you want the eval harness spec authored by you (Architect) or built ad-hoc by Builder in the Tier 0 PR? (Recommend: Builder ships a skeleton now, you formalize acceptance thresholds.)
2. For recolor, confirm we support **both** separation-remap and per-element-mask modes (§4) — this changes the Phase A spec surface.
3. For density, confirm template-match/auto-mask as primary localizer over LLM centroids (§4).
4. Should the swatch fallback be kept long-term or deleted once SAM2 scale lands? (Recommend: keep as the offline/degraded path tied to the feature flag.)
