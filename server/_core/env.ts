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
  /**
   * Route the Recolor control through the deterministic separation-remap op
   * (A1) instead of the generative path. Default off — generative recolor stays
   * the fallback until A1 clears its eval gate. Requires a source color input.
   */
  studioDeterministicRecolor: process.env.STUDIO_DETERMINISTIC_RECOLOR === "true",
  /** Route Scale through the deterministic scalePrintRepeat op. Eval-only; default off. */
  studioDeterministicScale: process.env.STUDIO_DETERMINISTIC_SCALE === "true",
  /** Route Density through the deterministic thinDensity op. Eval-only; default off. */
  studioDeterministicDensity: process.env.STUDIO_DETERMINISTIC_DENSITY === "true",
  /** Replicate SAM2 (D1 = Option 2). Token + model-version id for the hosted mask source. */
  replicateApiToken: process.env.REPLICATE_API_TOKEN ?? "",
  replicateSam2Model: process.env.REPLICATE_SAM2_MODEL ?? "",
};
