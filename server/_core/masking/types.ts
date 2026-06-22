/**
 * Mask interface for Print Studio deterministic editing.
 *
 * Per Architect Ruling Amendment 1 (docs/print-studio-decision-review.md §13):
 * the deterministic scale/density/recolor operations consume THIS interface,
 * never a specific segmentation model. The classical (vision-box + GrabCut) and
 * hosted SAM 2 implementations are swappable behind it, so upgrading the mask
 * source after the S5 spike touches none of the op code.
 *
 * Two halves, deliberately decoupled by readiness:
 *  - `bbox` (normalized) is producible TODAY via the vision LLM.
 *  - `raster` (a pixel bitmap) requires a raster-capable provider: classical
 *    needs `sharp` (spike S3), SAM 2 needs hosting (D1 + S5). Until a provider
 *    reports `rasterReady`, consumers must treat `raster` as absent.
 */

/** Axis-aligned bounding box, all fields normalized 0..1 to image dimensions. */
export interface BBoxNormalized {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A single-channel pixel mask. `data[i]` is 0 (excluded) .. 255 (included). */
export interface RasterMask {
  width: number;
  height: number;
  data: Uint8Array;
}

export type MaskProviderName = "classical" | "sam2";

/** Mask of the printed-fabric region. */
export interface FabricMask {
  /** Always present — the region's bounding box. */
  bbox: BBoxNormalized;
  /** 0..1 confidence from the locator. */
  confidence: number;
  /** Present only when produced by a raster-capable provider. */
  raster?: RasterMask;
  /**
   * Garment silhouette boundary (SAM2 combined mask). Only present when produced
   * by a raster-capable provider. Used by densityRedistribute for layout
   * constraints and compositing clip — keeps motifs strictly on the garment.
   * The primary `raster` (full-crop fill) remains the sampling mask for base-cloth
   * color extraction (v1 densityThin compatibility).
   */
  boundaryRaster?: RasterMask;
  provider: MaskProviderName;
}

/** Mask of one localized print motif instance (for density). */
export interface InstanceMask {
  bbox: BBoxNormalized;
  raster?: RasterMask;
}

/**
 * Per-call audit context (privacy gate Requirement 2). Stamped on every outbound
 * SAM2 call so the audit log attributes the request to the right tenant/job.
 */
export interface Sam2AuditContext {
  orgId?: string;
  jobId?: string;
}

/** Reference to the image to segment (storage path like /manus-storage/... or a URL). */
export interface MaskImageInput {
  url: string;
  /**
   * C5: audit context carried with the request itself, so concurrent jobs across
   * tenants cannot mis-attribute each other's outbound SAM2 calls (a module-level
   * global would race under `Promise.allSettled` / multi-tenant concurrency).
   */
  audit?: Sam2AuditContext;
}

/**
 * Swappable segmentation provider. Implementations: `classicalProvider`,
 * `sam2Provider`. Selected via `getMaskProvider()`.
 */
export interface MaskProvider {
  readonly name: MaskProviderName;
  /** True once this provider can return `raster` bitmaps (deps/hosting ready). */
  readonly rasterReady: boolean;
  /** Locate the printed-fabric region. */
  getFabricMask(image: MaskImageInput): Promise<FabricMask>;
  /** Localize individual motif instances within the fabric region (density). */
  getInstanceMasks(image: MaskImageInput, fabric: FabricMask): Promise<InstanceMask[]>;
  /**
   * Fabric + instances from a SINGLE segmentation call (density's single-call path
   * — avoids the double SAM2 call of getFabricMask + getInstanceMasks). A
   * non-raster-ready provider returns a raster-less fabric + [] instances, which
   * the density helper treats as a degrade (fail + refund).
   */
  getSegmentation(image: MaskImageInput): Promise<{ fabric: FabricMask; instances: InstanceMask[] }>;
}

/** Thrown when an operation is defined but its raster backend is not wired yet. */
export class MaskNotImplementedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MaskNotImplementedError";
  }
}

/** Thrown when a provider cannot run because its dependency/hosting is unprovisioned. */
export class MaskProviderUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MaskProviderUnavailableError";
  }
}
