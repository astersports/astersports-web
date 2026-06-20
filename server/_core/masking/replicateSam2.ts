/**
 * Replicate SAM2 client (the one piece that touches the hosted model).
 *
 * ⚠️ NEEDS LIVE VERIFICATION. The Architect ruling says to PORT Manus's already-
 * working Replicate client and verify independently — this is a best-effort
 * implementation against Replicate's standard predictions API, factored behind
 * the `Sam2Client` seam so Manus's verified request/response shape (model
 * version + output format) can be dropped in without touching sam2Provider.
 *
 * Config (env): REPLICATE_API_TOKEN, REPLICATE_SAM2_MODEL (a model version id).
 * When the token is missing, the default client throws MaskProviderUnavailableError
 * so STUDIO_MASK_PROVIDER=sam2 fails safe until provisioned.
 */
import { ENV } from "../env";
import { fetchWithTimeout } from "../../fetchTimeout";
import { MaskProviderUnavailableError } from "./types";

export interface Sam2Client {
  /** Box-prompted fabric-region mask. box = [x0,y0,x1,y1] in pixels. */
  boxMask(imageDataUrl: string, box: [number, number, number, number]): Promise<Buffer>;
  /** Automatic instance masks (one PNG per motif instance). */
  autoMasks(imageDataUrl: string): Promise<Buffer[]>;
}

const REPLICATE_API = "https://api.replicate.com/v1/predictions";
const POLL_TIMEOUT_MS = 60_000;

async function runPrediction(version: string, input: Record<string, unknown>): Promise<unknown> {
  const token = ENV.replicateApiToken;
  const create = await fetchWithTimeout(
    REPLICATE_API,
    {
      method: "POST",
      headers: { Authorization: `Token ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ version, input }),
    },
    POLL_TIMEOUT_MS
  );
  if (!create.ok) throw new Error(`Replicate create failed: ${create.status} ${await create.text().catch(() => "")}`);
  let pred = (await create.json()) as { id: string; status: string; output?: unknown; urls?: { get?: string } };

  const getUrl = pred.urls?.get ?? `${REPLICATE_API}/${pred.id}`;
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (pred.status !== "succeeded" && pred.status !== "failed" && pred.status !== "canceled") {
    if (Date.now() > deadline) throw new Error("Replicate prediction timed out");
    await new Promise((r) => setTimeout(r, 1500));
    const poll = await fetchWithTimeout(getUrl, { headers: { Authorization: `Token ${token}` } }, POLL_TIMEOUT_MS);
    pred = (await poll.json()) as typeof pred;
  }
  if (pred.status !== "succeeded") throw new Error(`Replicate prediction ${pred.status}`);
  return pred.output;
}

/** Tolerant output->URL[] extraction (shape varies by model — VERIFY per model). */
function outputToUrls(output: unknown): string[] {
  if (typeof output === "string") return [output];
  if (Array.isArray(output)) return output.filter((u): u is string => typeof u === "string");
  if (output && typeof output === "object") {
    const o = output as Record<string, unknown>;
    const cand = o.individual_masks ?? o.masks ?? o.combined_mask ?? o.mask;
    if (typeof cand === "string") return [cand];
    if (Array.isArray(cand)) return cand.filter((u): u is string => typeof u === "string");
  }
  return [];
}

async function fetchBuffer(url: string): Promise<Buffer> {
  const res = await fetchWithTimeout(url, {}, POLL_TIMEOUT_MS);
  if (!res.ok) throw new Error(`Replicate mask download failed: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/** Default client. Throws MaskProviderUnavailableError when unconfigured. */
export function defaultSam2Client(): Sam2Client {
  const ensure = () => {
    if (!ENV.replicateApiToken || !ENV.replicateSam2Model) {
      throw new MaskProviderUnavailableError(
        "SAM2 not provisioned: set REPLICATE_API_TOKEN and REPLICATE_SAM2_MODEL. " +
          "(Replicate request/response shape must be verified against Manus's working client.)"
      );
    }
  };
  return {
    async boxMask(imageDataUrl, box) {
      ensure();
      const out = await runPrediction(ENV.replicateSam2Model, { image: imageDataUrl, box });
      const urls = outputToUrls(out);
      if (urls.length === 0) throw new Error("SAM2 boxMask returned no mask");
      return fetchBuffer(urls[0]);
    },
    async autoMasks(imageDataUrl) {
      ensure();
      const out = await runPrediction(ENV.replicateSam2Model, { image: imageDataUrl });
      const urls = outputToUrls(out);
      return Promise.all(urls.map(fetchBuffer));
    },
  };
}
