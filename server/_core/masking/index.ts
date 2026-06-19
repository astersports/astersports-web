/**
 * Mask provider registry — the single seam the deterministic scale/density/
 * recolor operations import. Selection is env-driven (STUDIO_MASK_PROVIDER),
 * defaulting to the classical floor. Swapping classical -> sam2 is a config
 * change, not a code change (Amendment 1 §13.3).
 */
import { ENV } from "../env";
import type { MaskProvider, MaskProviderName } from "./types";
import { classicalProvider } from "./classicalProvider";
import { sam2Provider } from "./sam2Provider";

export * from "./types";
export { locateFabricRegion } from "./locateFabricRegion";
export type { FabricRegionResult } from "./locateFabricRegion";

const REGISTRY: Record<MaskProviderName, MaskProvider> = {
  classical: classicalProvider,
  sam2: sam2Provider,
};

/**
 * Resolve the active mask provider. Pass `override` (e.g. in tests) to bypass
 * the env selection. Unknown names fall back to the classical floor.
 */
export function getMaskProvider(override?: MaskProviderName): MaskProvider {
  const name = override ?? ENV.maskProvider;
  return REGISTRY[name] ?? classicalProvider;
}
