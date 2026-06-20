/**
 * Replicate SAM2 client (the one piece that touches the hosted model).
 *
 * Ported from Manus's verified client (the retired `server/replicateClient.ts`):
 * the `meta/sam-2` slug via the `replicate` SDK, automatic mask generation, and the
 * output shape `{ combined_mask, individual_masks }`.
 *
 * ⚠️ ONE LIVE CONFIRMATION CALL STILL REQUIRED before any flag flip (per the
 * Architect sequence): that `meta/sam-2` accepts a base64 **data-URL** input and that
 * the auto path returns the expected shape end to end. The real-garment eval call we
 * must run before go-live doubles as that confirmation.
 *
 * One auto call per crop returns BOTH halves, so callers never need a second call:
 *   - `combined`    (combined_mask)    -> fabric-raster source for scale
 *   - `individuals` (individual_masks) -> motif instance masks for density
 * This eliminates the unverified box-prompt input and the double SAM2 call.
 *
 * Image input: a base64 data-URL of the fabric crop — privacy-minimal (bytes in the
 * payload, nothing written to Aster storage, no temp object, no URL in Replicate
 * metadata). Fall back to a signed crop-URL ONLY if meta/sam-2 rejects data URLs
 * (Architect ruling); that fallback changes the privacy story and the disclosure doc.
 *
 * Config (env): REPLICATE_API_TOKEN (required). REPLICATE_SAM2_MODEL optionally
 * overrides the model slug/version. Missing token -> MaskProviderUnavailableError,
 * so STUDIO_MASK_PROVIDER=sam2 fails safe until provisioned.
 */
import Replicate from "replicate";
import { ENV } from "../env";
import { safeFetchBuffer } from "../net/safeFetch";
import { MaskProviderUnavailableError } from "./types";

/**
 * Automatic-mask tuning, harvested from the retired hybrid pipeline. Defaults are
 * tuned for dense print patterns (many small motifs), not pixel-perfect edges.
 */
export interface Sam2AutoOptions {
  pointsPerSide?: number;
  predIouThresh?: number;
  stabilityScoreThresh?: number;
  useM2M?: boolean;
}

export interface Sam2Segmentation {
  /** combined_mask PNG bytes (all segments overlaid) — fabric-raster source. */
  combined: Buffer;
  /** individual_masks PNG bytes (one per motif) — density instance masks. */
  individuals: Buffer[];
}

export interface Sam2Client {
  /** One automatic segmentation call on the crop; returns combined + individuals. */
  autoSegment(imageDataUrl: string, options?: Sam2AutoOptions): Promise<Sam2Segmentation>;
  /**
   * Box-prompted whole-fabric mask (box = [x0,y0,x1,y1] px). The PROVEN fabric
   * source — kept as the validated fallback (Architect ruling): combined_mask is
   * the provisional default, boxMask is the reserve until the IoU re-confirmation
   * rules. Same SDK transport as autoSegment.
   */
  boxMask(imageDataUrl: string, box: [number, number, number, number]): Promise<Buffer>;
}

const SAM2_MODEL = "meta/sam-2";
const DOWNLOAD_TIMEOUT_MS = 30_000;

/**
 * Resolve REPLICATE_SAM2_MODEL into a ref the SDK's `run()` accepts.
 * `run()` wants `owner/model` or `owner/model:version` — NOT a bare version hash.
 * So a configured value WITH a slash is used as-is; a bare version hash (no slash,
 * e.g. the confirmed `fe97b45...`) is pinned to `meta/sam-2:<hash>`; empty -> slug.
 */
export function resolveModelRef(configured?: string): `${string}/${string}` {
  const v = (configured ?? "").trim();
  if (!v) return SAM2_MODEL;
  return (v.includes("/") ? v : `${SAM2_MODEL}:${v}`) as `${string}/${string}`;
}

/** Coerce a Replicate output entry to a URL string (tolerates SDK FileOutput). */
function asUrl(v: unknown): string {
  if (typeof v === "string") return v;
  if (v && typeof (v as { url?: unknown }).url === "function") {
    const u = (v as { url: () => unknown }).url();
    return typeof u === "string" ? u : String(u);
  }
  return v ? String(v) : "";
}

async function fetchBuffer(url: string): Promise<Buffer> {
  // H1: mask URLs come from the third-party Replicate response body, so they are
  // SSRF-validated and redirect-revalidated before download (CLAUDE.md §5).
  const { buffer, response } = await safeFetchBuffer(url, { timeoutMs: DOWNLOAD_TIMEOUT_MS });
  if (!response.ok) throw new Error(`Replicate mask download failed: ${response.status}`);
  return buffer;
}

/** Tolerant single-mask URL extractor for boxMask (prefer a whole-region mask). */
function firstMaskUrl(output: unknown): string {
  if (typeof output === "string") return output;
  if (Array.isArray(output)) return asUrl(output[0]);
  if (output && typeof output === "object") {
    const o = output as Record<string, unknown>;
    const cand =
      o.combined_mask ?? o.mask ??
      (Array.isArray(o.individual_masks) ? (o.individual_masks as unknown[])[0] : undefined) ??
      (Array.isArray(o.masks) ? (o.masks as unknown[])[0] : undefined);
    return asUrl(cand);
  }
  return "";
}

function requireToken(): string {
  const token = ENV.replicateApiToken;
  if (!token) {
    throw new MaskProviderUnavailableError(
      "SAM2 not provisioned: set REPLICATE_API_TOKEN. " +
        "(One live confirmation call still required: data-URL acceptance + auto path.)"
    );
  }
  return token;
}

/** Default client. Throws MaskProviderUnavailableError when unconfigured. */
export function defaultSam2Client(): Sam2Client {
  return {
    async autoSegment(imageDataUrl, options) {
      const token = requireToken();
      // useFileOutput:false -> outputs come back as plain URL strings (the shape the
      // verified client parsed), not FileOutput wrappers.
      const replicate = new Replicate({ auth: token, useFileOutput: false });
      const input = {
        image: imageDataUrl,
        points_per_side: options?.pointsPerSide ?? 64,
        pred_iou_thresh: options?.predIouThresh ?? 0.82,
        stability_score_thresh: options?.stabilityScoreThresh ?? 0.88,
        use_m2m: options?.useM2M ?? true,
      };
      const output = (await replicate.run(resolveModelRef(ENV.replicateSam2Model), { input })) as Record<string, unknown>;

      const combinedUrl = asUrl(output?.combined_mask);
      const individualUrls = Array.isArray(output?.individual_masks)
        ? (output.individual_masks as unknown[]).map(asUrl).filter((u) => u.length > 0)
        : [];
      if (!combinedUrl && individualUrls.length === 0) {
        throw new Error("SAM2 returned no masks. The crop may contain no detectable motifs.");
      }

      const [combined, individuals] = await Promise.all([
        combinedUrl ? fetchBuffer(combinedUrl) : Promise.resolve(Buffer.alloc(0)),
        Promise.all(individualUrls.map(fetchBuffer)),
      ]);
      return { combined, individuals };
    },

    async boxMask(imageDataUrl, box) {
      const token = requireToken();
      const replicate = new Replicate({ auth: token, useFileOutput: false });
      const output = await replicate.run(resolveModelRef(ENV.replicateSam2Model), {
        input: { image: imageDataUrl, box },
      });
      const url = firstMaskUrl(output);
      if (!url) throw new Error("SAM2 boxMask returned no mask");
      return fetchBuffer(url);
    },
  };
}
