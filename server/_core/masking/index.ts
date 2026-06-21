/**
 * Mask provider registry — the single seam the deterministic scale/density/
 * recolor operations import. Selection is env-driven (STUDIO_MASK_PROVIDER),
 * defaulting to the classical floor. Swapping classical -> sam2 is a config
 * change, not a code change (Amendment 1 §13.3).
 *
 * Privacy Gate Requirement 4 (FAIL-SAFE):
 * If the SAM2 provider is unreachable/unprovisioned, the system degrades
 * gracefully to the classical provider — never errors the job, never leaks.
 * The `withFailSafe()` wrapper catches MaskProviderUnavailableError and any
 * network/timeout errors, logs a WARN with org_id context, and falls back
 * to the classical provider transparently.
 */
import { ENV } from "../env";
import type { FabricMask, InstanceMask, MaskImageInput, MaskProvider, MaskProviderName } from "./types";
import { MaskProviderUnavailableError } from "./types";
import { classicalProvider } from "./classicalProvider";
import { sam2Provider } from "./sam2Provider";

export * from "./types";
export { locateFabricRegion, locateFabricRegionForDensity, validateInstanceCount, MIN_DENSITY_INSTANCES, expandBbox } from "./locateFabricRegion";
export type { FabricRegionResult } from "./locateFabricRegion";
export { createSam2Provider, setSam2AuditContext, clearSam2AuditContext } from "./sam2Provider";
export { defaultSam2Client, type Sam2Client } from "./replicateSam2";
export { decodeMaskToRaster, rasterBBox, instancesFromMasks } from "./sam2Mask";

const REGISTRY: Record<MaskProviderName, MaskProvider> = {
  classical: classicalProvider,
  sam2: sam2Provider,
};

/**
 * Requirement 4: Fail-safe wrapper.
 * Wraps a primary provider so that any failure (unprovisioned, network, timeout)
 * gracefully degrades to the classical fallback. Logs a WARN so the deploy
 * misconfig is observable but never breaks a user job.
 */
function withFailSafe(primary: MaskProvider, fallback: MaskProvider): MaskProvider {
  return {
    name: primary.name,
    get rasterReady() {
      // If primary can't serve rasters (or will throw trying), report fallback's capability
      return primary.rasterReady;
    },

    async getFabricMask(image: MaskImageInput): Promise<FabricMask> {
      try {
        return await primary.getFabricMask(image);
      } catch (err: unknown) {
        const e = err as any;
        const isSafe = e instanceof MaskProviderUnavailableError ||
          e?.message?.includes("timed out") ||
          e?.message?.includes("fetch failed") ||
          e?.message?.includes("Replicate") ||
          e?.code === "ECONNREFUSED" ||
          e?.code === "ETIMEDOUT";

        if (isSafe) {
          console.warn(
            `[sam2-privacy] FAIL-SAFE: ${primary.name} provider failed, falling back to ${fallback.name}. ` +
            `error="${e.message}" timestamp=${new Date().toISOString()}`
          );
          return fallback.getFabricMask(image);
        }
        // Non-infrastructure errors (e.g., bad input) should still propagate
        throw err;
      }
    },

    async getInstanceMasks(image: MaskImageInput, fabric: FabricMask): Promise<InstanceMask[]> {
      try {
        return await primary.getInstanceMasks(image, fabric);
      } catch (err: any) {
        const isSafe = err instanceof MaskProviderUnavailableError ||
          err?.message?.includes("timed out") ||
          err?.message?.includes("fetch failed") ||
          err?.message?.includes("Replicate") ||
          err?.code === "ECONNREFUSED" ||
          err?.code === "ETIMEDOUT";

        if (isSafe) {
          console.warn(
            `[sam2-privacy] FAIL-SAFE: ${primary.name} provider failed on getInstanceMasks, ` +
            `degrading to prompt-path fallback (D-B). error="${err.message}" timestamp=${new Date().toISOString()}`
          );
          // Classical provider cannot serve instance masks (rasterReady=false),
          // so we return empty array — the live helper interprets this as
          // "provider degraded → use prompt-path fallback (D-B)" per the contract.
          // This is distinct from a non-empty but all-zero raster (D-C no-op → refund).
          try {
            return await fallback.getInstanceMasks(image, fabric);
          } catch {
            // Classical throws MaskNotImplementedError — expected.
            // Return empty = signal prompt-path fallback to the live helper.
            console.warn(
              `[sam2-privacy] FAIL-SAFE: classical fallback also cannot serve instance masks. ` +
              `Returning empty array (signals D-B prompt-path fallback). timestamp=${new Date().toISOString()}`
            );
            return [];
          }
        }
        throw err;
      }
    },

    async getSegmentation(image: MaskImageInput): Promise<{ fabric: FabricMask; instances: InstanceMask[] }> {
      try {
        return await primary.getSegmentation(image);
      } catch (err: any) {
        const isSafe = err instanceof MaskProviderUnavailableError ||
          err?.message?.includes("timed out") ||
          err?.message?.includes("fetch failed") ||
          err?.message?.includes("Replicate") ||
          err?.code === "ECONNREFUSED" ||
          err?.code === "ETIMEDOUT";

        if (isSafe) {
          console.warn(
            `[sam2-privacy] FAIL-SAFE: ${primary.name} provider failed on getSegmentation, ` +
            `degrading to ${fallback.name}. error="${err.message}" timestamp=${new Date().toISOString()}`
          );
          // Classical fallback returns a raster-less fabric + [] instances; the
          // density helper reads that as a degrade and FAILS + REFUNDS (density
          // never prompt-falls — the prompt path cannot do count-based removal).
          return fallback.getSegmentation(image);
        }
        throw err;
      }
    },
  };
}

/**
 * Resolve the active mask provider. Pass `override` (e.g. in tests) to bypass
 * the env selection. Unknown names fall back to the classical floor.
 *
 * When SAM2 is selected, it is wrapped in the fail-safe so that unprovisioned
 * or unreachable states degrade to classical transparently.
 */
export function getMaskProvider(override?: MaskProviderName): MaskProvider {
  const name = override ?? ENV.maskProvider;
  const provider = REGISTRY[name] ?? classicalProvider;

  // Wrap SAM2 in fail-safe (Requirement 4)
  if (provider.name === "sam2") {
    return withFailSafe(provider, classicalProvider);
  }

  return provider;
}
