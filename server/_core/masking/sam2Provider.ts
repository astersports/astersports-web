/**
 * SAM 2 mask provider — the BEST-IN-CLASS tier (Amendment 1 §13.2).
 *
 * Stub only. Hosting (self-host vs fal.ai/Replicate) is gated on Frank's tier
 * decision (D1) and the S5 spike evidence. One model serves fabric-region masks
 * plus automatic instance masks. When provisioned, implement against the same
 * MaskProvider interface so no deterministic-op code changes.
 */
import type { FabricMask, InstanceMask, MaskProvider } from "./types";
import { MaskProviderUnavailableError } from "./types";

const UNAVAILABLE =
  "SAM 2 segmentation is not provisioned. It is gated on the D1 tier decision and the S5 spike. " +
  "Set STUDIO_MASK_PROVIDER=classical (default) until hosting is approved.";

export const sam2Provider: MaskProvider = {
  name: "sam2",
  rasterReady: false,

  async getFabricMask(): Promise<FabricMask> {
    throw new MaskProviderUnavailableError(UNAVAILABLE);
  },

  async getInstanceMasks(): Promise<InstanceMask[]> {
    throw new MaskProviderUnavailableError(UNAVAILABLE);
  },
};
