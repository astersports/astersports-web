/**
 * Classical mask provider — the ship-now FLOOR (Amendment 1 §13.2/§13.3).
 *
 * Today it delivers the real vision-LLM bounding box. The raster refinement
 * (GrabCut region mask) and template-matched instance localization require a
 * raster library (`sharp`), which is gated on spike S3 — until then
 * `rasterReady` is false and instance localization throws explicitly.
 *
 * No GPU, no third party, customer art stays in-boundary.
 */
import type { FabricMask, InstanceMask, MaskImageInput, MaskProvider } from "./types";
import { MaskNotImplementedError } from "./types";
import { locateFabricRegion } from "./locateFabricRegion";

export const classicalProvider: MaskProvider = {
  name: "classical",
  // Flip to true once `sharp` + GrabCut land (spike S3) and raster masks are produced.
  rasterReady: false,

  async getFabricMask(image: MaskImageInput): Promise<FabricMask> {
    const region = await locateFabricRegion(image.url);
    return {
      bbox: region.bbox,
      confidence: region.confidence,
      provider: "classical",
      // `raster` intentionally omitted until rasterReady (S3). Consumers must check.
    };
  },

  async getInstanceMasks(): Promise<InstanceMask[]> {
    throw new MaskNotImplementedError(
      "classical instance localization (template-matching) requires raster ops via `sharp` — gated on spike S3/S5"
    );
  },
};
