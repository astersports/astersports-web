# Density — Optimization & Safeguards Audit

**Status:** review record (CC → Architect, §2.2). No optimization code merged with this doc.
**Method:** 8 parallel validators, each cross-referencing a proposed optimization (or a safeguard dimension) against the actual code on `main` and published technique. Every finding is `file:line` grounded; sources cited.

> **Headline:** A four-part "optimization & performance hardening" spec was proposed (O(1) spatial-hash grid; a 45s "circuit breaker"; 1-bit-packed masks; a hexagonal-packing pre-flight bound), framed as making the module "best-in-class, sub-second, 100% accuracy." **Of the four, three solve non-problems and should not be built; one (the worker deadline) is real but mis-specced.** "Sub-second end-to-end" and "100% accuracy" are not achievable on this architecture and are retired as goals. The genuinely high-value work is unglamorous: observability, a worker deadline, a poison-pill cap, segmentation caching, and the eval bench — most of it the prior `DENSITY_REBUILD_PLAN.md` already prioritized.

---

## 1. The four proposed optimizations — verdicts

### #1 O(1) Spatial-Hash Grid (`blueNoiseLayout.ts`) — **SKIP (as a perf item)**
- The claimed "O(M·N) bottleneck on 40MP canvases" **does not exist**: the layout is `O(iterations·M·CAP)` with `iterations=10`, `M≤200`, `CAP=20000` — **megapixel-independent, already ~tens of ms** (`blueNoiseLayout.ts:97-101,175`; the header documents this).
- Internal contradiction: the prose says "check 8 adjacent cells," its own code checks a 5×5=25-cell window — and **25 is correct** for `s=r/√2` (Bridson 2007); the prose is the bug.
- Category error: the grid's "one point per cell" invariant holds for **Poisson-disk rejection**, not **Lloyd centroids** (which drift arbitrarily close). It's a Bridson primitive **misattributed** as a Lloyd optimization.
- **Disposition:** optimizing a sub-100ms step behind a 20-120s model call is ~0% user-visible (Amdahl). The grid belongs **only inside** a Bridson layout *quality* rewrite (the prior audit's clustering fix), re-validated on the eval bench — never as a standalone perf change to the deterministic layout.

### #2 "Introspective Circuit Breaker" (45s loop deadline) — **BUILD, re-specced (the one salvageable item)**
- The *need* is real and already prioritized: the async worker has **no internal wall-clock timeout**; a hang is invisible until the 10-min reaper (`studioAsyncWorker.ts:25-83`).
- But the spec is wrong on framing, location, value, and name:
  - **"before the 60s ingress cap"** — the worker runs **off-request**; the ingress cap does not apply. The only existing bound is the 10-min reaper.
  - **"45s loop check"** — there is **no loop to break** (fixed-iteration, CAP-bounded CPU); the real unbounded wait is the awaited Replicate/network I/O, which a loop-head check can't interrupt.
  - **45s would false-kill** legitimate 45-120s SAM2 jobs.
  - It's a **per-job deadline**, not a cross-request circuit breaker (different pattern).
- **Correct design:** `AbortController` + `Promise.race` around the **whole** `processAsyncJob` op, **~90-120s** (comfortably under the reaper), signal threaded into the network calls so the timeout *cancels* rather than leaks, monotonic `performance.now()`, throwing a catchable error into the **existing `try/catch` → `failAndRefund`** (idempotent, reaper-compatible) + a `log.warn`. **Money-path → Architect-scoped.** Drop the convergence-epsilon early-stop (it's a *convergence* test, exactly what this deliberately-sub-convergence blue-noise op avoids; would break determinism).

### #3 1-bit-packed masks — **SKIP**
- Memory ranking at 40MP: (1) **per-instance rasters remapped to full-image × up to 200 = up to ~8GB** (the real OOM bound the instance cap exists for; `sam2Provider.ts:254`); (2) **160MB+ RGBA frame copies** (double-decoded in infill); … (5) the two masks the proposal targets = **80MB**.
- Bit-packing masks saves 70MB against a multi-hundred-MB/GB peak, **forces a full byte-unpack at every `sharp`/`blur` boundary** (masks feed `sharp` as raw 1-byte buffers — `infill.ts:75`), so you hold both representations at the hot moment (*more* peak memory), and rewrites ~15 pixel-scan sites. Same class of error as the earlier debunked `Uint8ClampedArray` claim.
- Latent bug if ever built: `1<<31` is negative int32 in JS — safe only with `!== 0` reads, broken under `>0`/`===mask`; int32 safety is cap-dependent.
- **Real memory work instead (if OOM is ever *measured*):** keep instance rasters **crop-sized / remap lazily** (rank 1), lower `STUDIO_MAX_MEGAPIXELS`, stop the double-decode in infill, tighten `decodeSemaphore` — all output-affecting or config, so bench-gated/verify-first.

### #4 Hexagonal-Packing Pre-Flight Bound — **SKIP**
- A packing *upper* bound (`M·πr² ≤ 0.9069·A`) cannot bind on an op that **reduces** count: the original `n` motifs already fit, survivors are a strict subset (`M<n`) re-placed at the same size. It guards an impossible condition (or, with `r` as an exclusion radius, **false-rejects valid jobs**).
- The area term is incoherent: `A` from `boundaryRaster` is the **motif union**, not garment area.
- The hexagonal limit is **already in the code** as the `eps=0.75` spacing target (`blueNoiseLayout.ts:135`, Gamito & Maddock 2008), deliberately sub-maximal. The only real capacity check (`M ≤ fabricArea`) already exists (`:90`).
- **Useful guard instead:** floor `removeN≥1` when `percent>0` (kills the small-n round-to-zero no-op) and a bare-ground-coverage precheck (the covered-print F2 no-op) — both target the *actual* refund causes.

---

## 2. Claims resolved

- **"#91 (eq→inArray) is a no-op because there's no status index" — WRONG (~0.9).** The bug is a value-binding/empty-result issue (`studioDb.ts:453-456`), index-independent (proven by the sibling SELECT returning empty on the same unindexed enum). #91 is a real fix. *Caveat:* the bug's existence is repo-asserted "confirmed" but not externally corroborated (~0.55) — the **V1 runtime probe** (jobs stuck in `sam2_processing`) still settles whether it's actively biting.
- **"`seg.combined` = motif union" — moderately supported (~0.7 dense, ~0.35 universal).** It's the union of *all retained SAM2 segments*; sparse motif-union on dense prints (the repo's own reason for not trusting it as the fabric raster), but content-dependent and downstream-used as the silhouette boundary. The live `seg.combined` dump (V4) remains the decisive measurement.

---

## 3. Speed & accuracy reality (the "100% / sub-second" reframe)

- **SAM2 is the DOMINANT cost** (the codebase says so — `env.ts:82`): ~20s warm on L40S, 30-180s cold-boot; CPU geometry is already **~100-300ms**. **Sub-second end-to-end is physically impossible** while a hosted SAM2 call is on the critical path.
- **"100% accuracy" is not an engineering quantity** — SAM2 structurally can't perfectly instance-segment a dense repeat (TextureSAM), and inpainting is ill-posed. The refund cascade is the *expected* output on hard inputs.
- **Honest framing:** "deterministic, byte-stable geometry that runs well under a second once segmentation returns" (true, a real differentiator) + "segmentation latency bounded and off the user's request (async)" (true). Accuracy is a **recall knob** (`points_per_side`) that trades against **GPU cost**, not user latency (the async path never even hits `RUN_TIMEOUT_MS`).
- **Where perf actually moves:** (1) SAM2 **cold-boot elimination / warm-pooling**; (2) **cache segmentation per `(image, bbox)`** so reruns of the same garment skip the model call entirely (highest-leverage; the iterate-on-one-garment path re-segments every time). Neither is a CPU micro-opt.

---

## 4. Safeguards — genuine gaps for "best in class" (new findings)

| Gap | Detail | Fix | Cite |
|---|---|---|---|
| **No worker deadline** | hang invisible until 10-min reaper | #2 above (~90-120s AbortController→failAndRefund) | Lambda/SFN timeout patterns |
| **No poison-pill / max-attempt cap** | a deterministically-failing job re-polls until the reaper, burning Replicate calls | cap ~5 attempts (Inngest 4-5 / SFN 3 / SQS 10) then terminal fail+refund | AWS/Inngest retry guidance |
| **Graceful shutdown** | worker must be **PID 1** to receive SIGTERM; K8s 30s grace | confirm PID-1 / add SIGTERM drain | K8s termination docs |
| **`sharp` concurrency/cache** | defaults to 1 on glibc-Linux w/o jemalloc; cache 50MB | verify prod container config (hidden bound *or* bottleneck) | sharp utility API |
| **Per-guard refund-reason telemetry** | post-#93 the worker log.warns on fail, but not *which* guard | tag F1/F2/F3/round-0/under-seg/degrade | durable-exec observability |

Idempotency note (validates #93): durable-execution best practice is the idempotency key must be stable across **retries of the same attempt** but distinct across **regenerate attempts** — exactly what #93's `predictionMeta.deductRef` key now does.

---

## 5. Priority roadmap (merging the optimization spec into the prior audit)

**Build now (fix-forward reliability/observability — not bench-gated):**
1. Per-guard **refund-reason telemetry** (the prerequisite that makes "is it broken" measurable).
2. **Worker deadline** (#2, re-specced) — money-path.
3. **Poison-pill max-attempt cap** (~5) — money-path (needs a poll-attempt counter; schema-adjacent).
4. **Verify** prod `sharp` concurrency/cache + worker PID-1/SIGTERM (ops checks, need prod access).
5. **`points_per_side` 16→32** — config; output-affecting ⇒ confirm on the bench.
6. **Stand up the G3 eval bench** — gate for everything below.

**Bench-gated (quality — do NOT ship blind):**
7. `baseClothAnchor` gutter-ring fallback; texture-aware infill; Bridson layout (the only legit home for the spatial grid + a feasibility clamp); linear-light compositing; lazy crop-sized instance rasters.

**Strategic (Architect fork):** NRT lattice density model; Hungarian assignment.

**Do NOT build:** the standalone spatial grid, bit-packed masks, the packing-bound pre-flight, the 45s loop-check, or anything justified by "100%/sub-second."

---

## 6. Sources
Bridson 2007 (Poisson-disk); de Goes 2012 / Balzer 2009 (blue noise); Gamito & Maddock 2008 (spacing formula); Lagae & Dutré 2008 (relative radius); Fejes Tóth (hex packing 0.9069); SAM2 AMG docs + TextureSAM (2505.16540) + Replicate model card (latency); PyTorch SAM2 + TinySAM (points_per_side² cost); OpenJS/Nearform AbortController; Azure/AWS circuit-breaker + durable-execution idempotency; sharp utility API; K8s termination. (Full URLs in the validator transcripts; mirrored in `/home/admin/DENSITY_*` working notes.)
