export const ENV = {
  appId: process.env.VITE_APP_ID ?? "",
  cookieSecret: process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
  stripeSecretKey: process.env.STRIPE_SECRET_KEY ?? "",
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? "",
  resendApiKey: process.env.RESEND_API_KEY ?? "",
  /**
   * Studio no-op guard: when enabled (default), an edited image is QA-checked
   * against the original and, if the requested change was not applied, the job
   * fails (and credits are refunded) instead of silently billing for a no-op.
   * Set STUDIO_NOOP_GUARD=false to disable.
   */
  studioNoOpGuard: process.env.STUDIO_NOOP_GUARD !== "false",
  /**
   * Active segmentation/mask provider for deterministic Print Studio edits.
   * "classical" (default) is the ship-now floor (vision box + GrabCut, raster
   * gated on spike S3). "sam2" is the hosted best-in-class tier (gated on D1/S5).
   */
  maskProvider: (process.env.STUDIO_MASK_PROVIDER === "sam2" ? "sam2" : "classical") as
    | "classical"
    | "sam2",
  /** A2: route recolor-only jobs through the deterministic separation-remap op in
   *  the live money path. Default off; flip after Architect verifies afac00a. */
  studioRecolorLive: process.env.STUDIO_RECOLOR_LIVE === "true",
  /** Scale-live: route scale-only jobs through scalePrintRepeat in the money path.
   *  Default off — lands dark; flip after the per-route real-garment eval passes.
   *  (Decision 5: the dead STUDIO_DETERMINISTIC_* eval flags were removed here —
   *  the scale/density/recolor eval runners invoke the ops directly, never gated.) */
  studioScaleLive: process.env.STUDIO_SCALE_LIVE === "true",
  /** D-C: Route density-only jobs through the deterministic densityThin op in the
   *  live money path. Requires SAM2 (raster + instances). Default off; flip after
   *  real-garment eval confirms countError <= 0.10 on production imagery. */
  studioDensityLive: process.env.STUDIO_DENSITY_LIVE === "true",
  /** Replicate SAM2 (D1 = Option 2). Token + model-version id for the hosted mask source. */
  replicateApiToken: process.env.REPLICATE_API_TOKEN ?? "",
  replicateSam2Model: process.env.REPLICATE_SAM2_MODEL ?? "",
};
