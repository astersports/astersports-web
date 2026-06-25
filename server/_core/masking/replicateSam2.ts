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

/**
 * Result of handling an async SAM2 prediction (ASYNC_GENERATION_SPEC §2). The worker maps
 * these: `succeeded` -> build fabric/instances + run the deterministic op; `failed` -> refund;
 * `processing` (still running) -> leave for the next poll tick. parseAutoSegmentation only
 * downloads masks on success, so a still-running poll does no network work.
 */
export type PredictionResult =
  | { status: "succeeded"; segmentation: Sam2Segmentation }
  | { status: "failed"; error: string }
  | { status: "processing" };

export interface Sam2Client {
  /** One automatic segmentation call on the crop; returns combined + individuals. */
  autoSegment(imageDataUrl: string, options?: Sam2AutoOptions): Promise<Sam2Segmentation>;
  /**
   * Async seam (ASYNC_GENERATION_SPEC §2): create the SAM2 prediction and return its id
   * WITHOUT waiting, so the 45-120s run lives on Replicate, off our 60s-capped request.
   * Pass `webhookUrl` to have Replicate POST on completion (Phase 3); either way the cron
   * poller resolves it via processPrediction. Same `input` shaping as autoSegment.
   */
  startPrediction(imageDataUrl: string, options?: Sam2AutoOptions, webhookUrl?: string): Promise<string>;
  /**
   * Resolve a started prediction by id: on success download the masks (SSRF-guarded) and
   * return the segmentation; on failure/cancel/abort surface the error; otherwise report it
   * is still running (no network work). Transport only — does NOT build fabric/instances or
   * run the deterministic op (those layer on top in the provider + worker).
   */
  processPrediction(predictionId: string): Promise<PredictionResult>;
  /**
   * Box-prompted whole-fabric mask (box = [x0,y0,x1,y1] px). The PROVEN fabric
   * source — kept as the validated fallback (Architect ruling): combined_mask is
   * the provisional default, boxMask is the reserve until the IoU re-confirmation
   * rules. Same SDK transport as autoSegment.
   */
  boxMask(imageDataUrl: string, box: [number, number, number, number]): Promise<Buffer>;
}

const SAM2_MODEL = "meta/sam-2";
/**
 * Confirmed-working SAM2 version (automatic-mask generation). This is the exact hash the
 * proven path uses (eval/generateSam2Mask.mjs, scripts/confirmDensityLive.mjs) and the
 * input/output shape this client builds (`image` + `points_per_side`/`use_m2m` -> `combined_mask`
 * + `individual_masks`) matches it.
 *
 * Why a VERSION and not the `meta/sam-2` slug: predictions.create() with a bare slug hits the
 * official-model endpoint (POST /v1/models/{owner}/{name}/predictions). SAM2 here is a COMMUNITY
 * model, so that slug 404s ("requested resource could not be found") — a community model must be
 * run by version (POST /v1/predictions with a `version` body). Pinning the proven version means an
 * unset REPLICATE_SAM2_MODEL — OR any version-less slug (`meta/sam-2`, `zsxkib/segment-anything-2`,
 * …) — still resolves to a runnable model. Override with a version: a bare hash or
 * `owner/model:version` (a bare slug can't select this community model — see resolvePredictionTarget).
 */
const SAM2_DEFAULT_VERSION = "fe97b453a6455861e3bac769b441ca1f1086110da7466dbb65cf1eecfd60dc83";
const DOWNLOAD_TIMEOUT_MS = 30_000;
/**
 * Caller-side deadline for replicate.run(). The SDK long-polls until the
 * prediction settles; without a ceiling a stuck/queued prediction hangs the
 * request indefinitely. 120s covers a normal cold-start + segmentation run.
 */
const RUN_TIMEOUT_MS = 120_000;

/**
 * Race a replicate.run() promise against a RUN_TIMEOUT_MS deadline so a stuck or
 * queued prediction can't hang the request forever. Rejects with a clear error on
 * timeout. (The in-flight prediction is abandoned, not cancelled — acceptable; the
 * alternative is an unbounded hang.)
 */
async function runWithTimeout<T>(label: string, p: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`SAM2 ${label} timed out after ${RUN_TIMEOUT_MS}ms`)),
      RUN_TIMEOUT_MS
    );
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Resolve REPLICATE_SAM2_MODEL into a ref the SDK's `run()` accepts (`owner/model:version`).
 * SAM2 here is a COMMUNITY model, so a version-LESS slug 404s on run() — always resolve to an
 * explicit version: the version side of "...:version", a bare hash, else the pinned default
 * (empty or any version-less slug). To point at another version set REPLICATE_SAM2_MODEL to that
 * version hash (or owner/model:version).
 */
export function resolveModelRef(configured?: string): `${string}/${string}` {
  const v = (configured ?? "").trim();
  const version = v.includes(":")
    ? v.split(":").pop()!.trim()
    : v && !v.includes("/")
      ? v
      : SAM2_DEFAULT_VERSION;
  return `${SAM2_MODEL}:${version}` as `${string}/${string}`;
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

/** Shared SAM2 auto-mask input — identical shape for the sync run() and the async create(). */
function buildAutoInput(imageDataUrl: string, options?: Sam2AutoOptions) {
  return {
    image: imageDataUrl,
    points_per_side: options?.pointsPerSide ?? ENV.studioSam2PointsPerSide,
    pred_iou_thresh: options?.predIouThresh ?? 0.82,
    stability_score_thresh: options?.stabilityScoreThresh ?? 0.88,
    use_m2m: options?.useM2M ?? ENV.studioSam2UseM2m,
  };
}

/** Parse a SAM2 auto output into combined + individual mask buffers (SSRF-guarded download).
 *  Shared by autoSegment (sync run) and processPrediction (async) so both paths parse the
 *  output identically. Throws when the model returned no usable masks. */
async function parseAutoSegmentation(output: unknown): Promise<Sam2Segmentation> {
  const o = (output ?? {}) as Record<string, unknown>;
  const combinedUrl = asUrl(o.combined_mask);
  const individualUrls = Array.isArray(o.individual_masks)
    ? (o.individual_masks as unknown[]).map(asUrl).filter((u) => u.length > 0)
    : [];
  if (!combinedUrl && individualUrls.length === 0) {
    throw new Error("SAM2 returned no masks. The crop may contain no detectable motifs.");
  }
  const [combined, individuals] = await Promise.all([
    combinedUrl ? fetchBuffer(combinedUrl) : Promise.resolve(Buffer.alloc(0)),
    Promise.all(individualUrls.map(fetchBuffer)),
  ]);
  return { combined, individuals };
}

/** predictions.create() wants { model } OR { version }. SAM2 here is a COMMUNITY model, so the
 *  { model: slug } path (POST /v1/models/{owner}/{name}/predictions — OFFICIAL models only) 404s
 *  for it. So ALWAYS resolve to a { version }: the version side of "...:version", a bare hash, or
 *  (empty / any version-less slug, e.g. `meta/sam-2` or `zsxkib/segment-anything-2`) the pinned
 *  default. To run another version, set REPLICATE_SAM2_MODEL to that version hash (or
 *  owner/model:version) — a bare slug can't select a community model here. */
export function resolvePredictionTarget(configured?: string): { model: string } | { version: string } {
  const v = (configured ?? "").trim();
  if (v.includes(":")) return { version: v.split(":").pop()!.trim() };
  if (v && !v.includes("/")) return { version: v };
  return { version: SAM2_DEFAULT_VERSION };
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
      const output = (await runWithTimeout(
        "autoSegment",
        replicate.run(resolveModelRef(ENV.replicateSam2Model), { input: buildAutoInput(imageDataUrl, options) })
      )) as Record<string, unknown>;
      return parseAutoSegmentation(output);
    },

    async startPrediction(imageDataUrl, options, webhookUrl) {
      const token = requireToken();
      const replicate = new Replicate({ auth: token, useFileOutput: false });
      const target = resolvePredictionTarget(ENV.replicateSam2Model);
      const opts = {
        input: buildAutoInput(imageDataUrl, options),
        ...(webhookUrl
          ? { webhook: webhookUrl, webhook_events_filter: ["completed"] as ("start" | "output" | "logs" | "completed")[] }
          : {}),
      };
      // predictions.create() requires exactly one of { model } | { version }; branch so the
      // SDK's union type is satisfied concretely. Returns immediately (no long-poll).
      const prediction = await replicate.predictions.create(
        "version" in target ? { ...opts, version: target.version } : { ...opts, model: target.model }
      );
      return prediction.id;
    },

    async processPrediction(predictionId) {
      const token = requireToken();
      const replicate = new Replicate({ auth: token, useFileOutput: false });
      const prediction = await replicate.predictions.get(predictionId);
      if (prediction.status === "succeeded") {
        return { status: "succeeded", segmentation: await parseAutoSegmentation(prediction.output) };
      }
      if (prediction.status === "failed" || prediction.status === "canceled" || prediction.status === "aborted") {
        return { status: "failed", error: String(prediction.error ?? `SAM2 prediction ${prediction.status}`) };
      }
      return { status: "processing" };
    },

    async boxMask(imageDataUrl, box) {
      const token = requireToken();
      const replicate = new Replicate({ auth: token, useFileOutput: false });
      const output = await runWithTimeout(
        "boxMask",
        replicate.run(resolveModelRef(ENV.replicateSam2Model), {
          input: { image: imageDataUrl, box },
        })
      );
      const url = firstMaskUrl(output);
      if (!url) throw new Error("SAM2 boxMask returned no mask");
      return fetchBuffer(url);
    },
  };
}
