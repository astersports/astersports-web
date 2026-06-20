# Replicate Sub-Processor Disclosure

**Document version:** 1.0  
**Last updated:** 2026-06-20  
**Purpose:** Satisfy SAM2 Privacy Gate Requirement 3 (docs/sam2-privacy-gate.md)

---

## Sub-Processor Identity

| Field | Value |
|---|---|
| **Name** | Replicate, LLC |
| **Address** | 101 Townsend Street, San Francisco, CA 94107 |
| **Service** | SAM2 (Segment Anything Model 2) image segmentation via Predictions API |
| **Model** | `meta/sam-2` (official Meta model hosted by Replicate) |
| **Privacy contact** | privacy@replicate.com |
| **Privacy policy** | https://replicate.com/privacy (last updated April 1, 2026) |
| **Subprocessor list** | https://replicate.com/docs/topics/site-policy/subprocessors |

---

## What Data Is Sent

Only the **cropped fabric region** of the garment image is transmitted to Replicate. The full customer photo (including background, hanger, model, branding) is never sent. This is enforced by the `cropToFabricRegion()` function in `server/_core/masking/sam2Provider.ts` (Requirement 1: data minimization).

| Data element | Sent? | Notes |
|---|---|---|
| Cropped fabric region (PNG) | Yes | Only the bbox-extracted print area |
| Full garment photo | **No** | Cropped before transmission |
| Customer identity (name, email) | **No** | Not included in API payload |
| Org/tenant ID | **No** | Logged locally only (Requirement 2) |
| File metadata (EXIF, GPS) | **No** | Stripped by Sharp during decode/re-encode |

---

## Replicate Data Retention Policy

Per Replicate's official documentation (https://replicate.com/docs/topics/predictions/data-retention):

1. **Input data (the cropped image we send):** Replicate stores input files temporarily to process the prediction. Inputs provided as data URLs are ephemeral and not persisted to Replicate's file storage.

2. **Output data (mask PNGs):** Output files are stored temporarily and automatically deleted after a retention period (typically 1 hour for completed predictions).

3. **Prediction metadata:** Prediction records (ID, status, timestamps, model version) are retained in the account dashboard. These contain no customer image data.

4. **Manual deletion:** Predictions can be manually deleted via the Replicate dashboard or API, which removes all associated input/output data.

5. **No training:** Replicate does not use customer prediction inputs/outputs to train models. Per their privacy policy: data is used only "to provide our Services."

---

## Our Safeguards (Privacy Gate Implementation)

| Requirement | Implementation | Verification |
|---|---|---|
| 1. Crop-to-fabric minimization | `cropToFabricRegion()` in sam2Provider.ts | Inspect outbound payload: only crop dimensions, no full image |
| 2. org_id audit logging | `logSam2Call()` structured log per outbound call | Log line: `[sam2-privacy] outbound SAM2 call: op=... org_id=... job_id=... crop_dimensions=... timestamp=...` |
| 3. Retention + sub-processor doc | This document | Linked from sam2-privacy-gate.md |
| 4. Fail-safe (fail closed) | `withFailSafe()` wrapper in masking/index.ts | MaskProviderUnavailableError → graceful fallback to classical provider + WARN log |

---

## Data Flow Diagram

```
Customer uploads garment photo
        │
        ▼
[Aster Sports Server — local processing only]
        │
        ├── 1. Vision LLM identifies fabric bbox (internal, no image leaves)
        │
        ├── 2. Image decoded + EXIF stripped (local Sharp)
        │
        ├── 3. CROP to fabric bbox only (local Sharp)
        │       └── Full image DISCARDED from outbound path
        │
        ├── 4. AUDIT LOG written (org_id, job_id, crop dimensions, timestamp)
        │
        ▼
[Replicate API — receives ONLY the cropped fabric region]
        │
        ├── SAM2 processes crop → returns mask PNG(s)
        │
        ├── Replicate auto-deletes input/output after retention period
        │
        ▼
[Aster Sports Server — receives mask, remaps to full image coordinates]
        │
        ▼
Deterministic op (scale/density/recolor) applied locally
```

---

## Customer-Facing Disclosure (for Terms of Service / DPA)

> Aster Sports uses Replicate, LLC (San Francisco, CA) as a sub-processor for image segmentation. Only the cropped fabric print region of uploaded garment photos is transmitted to Replicate for processing. No personally identifiable information, full garment photos, or customer metadata is shared. Replicate processes data ephemerally and does not use inputs for model training. For details, see Replicate's privacy policy at https://replicate.com/privacy.

---

## Review Schedule

This document should be reviewed:
- When Replicate updates their privacy policy or data retention terms
- When changing the SAM2 model version
- When adding new data sent to Replicate
- Annually as part of security review
