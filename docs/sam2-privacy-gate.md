# SAM2 privacy gate — clearance checklist

**Date:** 2026-06-20 · **Branch:** `claude/jolly-pascal-k9tw4r` · **Owner (build):** Manus · **Sign-off:** Architect · **Status:** IN PROGRESS (dispatched to Manus 2026-06-20)

## Why this gate exists
Going live with SAM2 means **customers' proprietary print artwork leaves our cloud** to a third-party GPU host (Replicate). For a tool sold to design firms this is a contractual/IP exposure, not a silent infra choice (per **D1**, `docs/print-studio-decision-review.md`; §3D, `docs/collaboration-next-steps.md`). These four safeguards must exist **before** customer data leaves. Until all four are met and signed off, the live flags (`STUDIO_SCALE_LIVE`, `STUDIO_DENSITY_LIVE`) are inert and no money-path/SAM2 route is built or shipped.

**Scope:** binds the **production** path (real customer art). The pre-launch **S5 spike on Frank's own sample garments** has no privacy constraint — hosted SAM2 may be used freely there to validate quality (D1). So eval/quality work can proceed ahead of this gate; only the live customer route waits on it.

---

## The four requirements

### 1. Crop-to-fabric minimization
- [ ] Only the **fabric region** (mask bbox crop) is sent to Replicate — never the full customer image/garment photo.
- **Acceptance:** the outbound request payload to Replicate contains only the cropped fabric raster; verified by inspecting the request the `sam2Provider` / `replicateSam2` client builds.
- **Rationale:** data minimization — the third party sees the least it needs.

### 2. org_id logging
- [ ] Every SAM2 call is logged with the tenant/org id (`ctx.tenant.id`).
- **Acceptance:** a log line per outbound SAM2 call carrying `org_id` (same id D-B's fallback WARN surfaces, `docs/scale-density-live-wiring-spec.md`); audit trail of whose art went where.

### 3. Retention + sub-processor documentation
- [ ] Written record: Replicate named as a **sub-processor**, what it retains, for how long, and that it is disclosed (DPA / data-residency posture).
- **Acceptance:** the doc exists and is linked here — it is the artifact a design-firm customer asks for.

### 4. Fail-safe (fail closed)
- [ ] If the provider is unreachable/unprovisioned, the system degrades **gracefully to the existing prompt path** — never errors the job, never leaks.
- **Acceptance:** with no `REPLICATE_API_TOKEN` (or provider down), a live-flagged request falls back to the prompt path. `defaultSam2Client` already throws `MaskProviderUnavailableError` without the token; the fail-safe turns that throw into a graceful degrade, paired with the D-B WARN. No broken job.

---

## Integration notes for the consumer seam (Builder → Manus)
The scale/density ops and the live wiring (`docs/scale-density-live-wiring-spec.md`)
consume the mask contract in `server/_core/masking/types.ts`. Two of the four
requirements change behavior the consumers depend on — handle them here so they
land clean, not at integration:

**#1 crop-to-fabric needs a coordinate round-trip, not just a crop.** Today
`sam2Provider` sends the full upright image and everything returns in **full-image
space**: `decodeMaskToRaster(maskPng, width, height)` builds the raster at
full-image dims, and `instancesFromMasks(masks, width, height)` returns instance
bboxes normalized to the full image. The ops composite into that **full-image
raster**. After cropping to the bbox before send, the Replicate response is in
**crop space** and must be translated back before returning:
- Place the fabric raster into a **full-image-sized raster at the crop origin**
  (zero-padded outside the crop) — do not return it at crop dims.
- **Re-normalize instance bboxes to the full image** (scale by crop fraction + add
  crop offset).
- Skipping this misaligns masks against the image the ops edit → scale/density
  composite garbage, silently, with no error.

**#4 fail-safe must respect the `rasterReady` / D-B / D-C split.** Classical degrade
is fine for **recolor** (`separationRemap` works off the classical bbox), but
classical is `rasterReady:false` and returns **no raster** / **no instances**, and
scale/density **throw without them**. A mid-job degrade must end up on the **D-B
prompt-path fallback**, not a **job-fail + refund**.

> **ARCHITECT CORRECTION (2026-06-20, supersedes the helper-level note below).**
> Distinguishing "instances `[]` from a fail-safe degrade (→ D-B)" vs "a genuine
> no-motif print (→ D-C refund)" **at the helper cannot work** — both yield
> `instances=[]` / `removed=0`, indistinguishable downstream. The robust
> separation is **at the gate, not the helper**: make `rasterReady` reflect
> **provisioning**, so an unprovisioned/unreachable SAM2 reports `rasterReady:false`
> and the route falls to the prompt path **before any op runs**. Then the only way
> to reach the op is a *provisioned* call, where `instances=[] / removed=0`
> unambiguously means **D-C no-op refund**. This is encoded in the locked
> scale/density prompts.

*Superseded helper-level sketch (kept for history):* degrade returns
`raster: undefined`; live helper treats missing raster → D-B and all-zero raster →
D-C. Correct intent, wrong layer — the gate-level `rasterReady`-reflects-provisioning
rule above is the one that ships.

---

## Clearance criteria — the gate is CLEARED when ALL of:
1. The four requirements above are checked and built by **Manus**.
2. The **Architect** reviews `sam2Provider` (at `005260c` or its successor SHA) and confirms all four are met — the formal sign-off.
3. **Replicate client live-verified**: model version pinned, input/output shape confirmed against the live endpoint (Manus).
4. **Frank** authorizes provisioning (`STUDIO_MASK_PROVIDER=sam2` + `REPLICATE_API_TOKEN`).

## After clearance
- Architect issues the locked **scale-live / density-live** build prompts, pinned against the now-verified raster + instance-mask shapes.
- Builder wires each **dark** behind `STUDIO_SCALE_LIVE` / `STUDIO_DENSITY_LIVE` (default OFF), per `docs/scale-density-live-wiring-spec.md` (D-A..D-D locked).
- Real-garment eval per route → Frank flips each flag.
