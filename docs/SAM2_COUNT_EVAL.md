# SAM2 count-accuracy eval — billing-grade density go/no-go

**Status: pending CI run.** This file is auto-populated by the `SAM2 count eval` GitHub
workflow (`.github/workflows/sam2-count-eval.yml`), which runs the real SAM2 production
count path with the `REPLICATE_API_TOKEN` secret and commits the results + overlays back
to this branch. Trigger it by pushing a change to `eval/RUN_SAM2_EVAL`.

What it will measure (see `eval/sam2CountEval.ts`):
- **Synthetic (rigorous, known N):** the 10 hard fixtures (overlap / multicolor /
  varied-ground / low-contrast) — SAM2 derived-instance count error vs the classical ~40%
  baseline, per condition, with up to 3 SAM2 param sets (pps16/32/64); best honest count
  reported (no per-image cherry-picking, no fitting to N).
- **Real florals (approximate):** 6 PDP florals, visual validation via overlays.
- **Derived instances** = production derivation (specks <0.02% dropped, giants >20% crop
  dropped as ground, cap 300) via `finishSam2Segmentation` — NOT raw mask count.
- A **VERDICT**: billing-grade density achievable, vs scope-and-gate to the prints SAM2
  can count.

Overlays will land in `eval/out/sam2-count/` (original | SAM2 instances | classical).
