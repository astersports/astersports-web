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

## Clearance criteria — the gate is CLEARED when ALL of:
1. The four requirements above are checked and built by **Manus**.
2. The **Architect** reviews `sam2Provider` (at `005260c` or its successor SHA) and confirms all four are met — the formal sign-off.
3. **Replicate client live-verified**: model version pinned, input/output shape confirmed against the live endpoint (Manus).
4. **Frank** authorizes provisioning (`STUDIO_MASK_PROVIDER=sam2` + `REPLICATE_API_TOKEN`).

## After clearance
- Architect issues the locked **scale-live / density-live** build prompts, pinned against the now-verified raster + instance-mask shapes.
- Builder wires each **dark** behind `STUDIO_SCALE_LIVE` / `STUDIO_DENSITY_LIVE` (default OFF), per `docs/scale-density-live-wiring-spec.md` (D-A..D-D locked).
- Real-garment eval per route → Frank flips each flag.
