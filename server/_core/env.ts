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
  /** Density v2 (proportional redistribution, Option B): route density jobs through
   *  the deterministic-composite densityRedistribute op (remove p%, relocate
   *  survivors to an even blue-noise layout) instead of the v1 erase-only
   *  densityThin. Requires SAM2 (raster + instances). Default off — lands DARK and
   *  is NOT router-wired; wiring + the flip are Frank's after the per-route eval
   *  gates clear. Patterned on studioDensityLive. */
  studioDensityRedistribute: process.env.STUDIO_DENSITY_REDISTRIBUTE === "true",
  /** Replicate SAM2 (D1 = Option 2). Token + model-version id for the hosted mask source. */
  replicateApiToken: process.env.REPLICATE_API_TOKEN ?? "",
  replicateSam2Model: process.env.REPLICATE_SAM2_MODEL ?? "",
  /** H6: upper bound on a source image's total pixel count for the deterministic
   *  ops. A decoded RGBA frame costs width*height*4 bytes, so an unbounded upload
   *  is a memory-exhaustion vector. 40 MP (~160 MB RGBA) covers real print artwork
   *  with headroom; raise via STUDIO_MAX_MEGAPIXELS only with the memory budget in mind. */
  studioMaxMegapixels: Math.max(1, Number(process.env.STUDIO_MAX_MEGAPIXELS ?? "40")),
  /** H6: max concurrent sharp decodes. Each decode holds a full RGBA frame in
   *  memory; without a cap, N simultaneous jobs multiply the peak. Default 4. */
  studioMaxConcurrentDecodes: Math.max(1, Number(process.env.STUDIO_MAX_CONCURRENT_DECODES ?? "4")),
  /** H2: allowlist of host[:port] values the OAuth redirect target may use. When
   *  set (comma-separated), a decoded `state` redirect whose host is not on the
   *  list is rejected — the anti-code-interception control. Empty = scheme/format
   *  validation only. */
  oauthAllowedRedirectHosts: (process.env.OAUTH_ALLOWED_REDIRECT_HOSTS ?? "")
    .split(",")
    .map((h) => h.trim())
    .filter(Boolean),
  /** H3: shared secret for server-to-server scheduled (cron) endpoints. When set,
   *  /api/scheduled/* requires a matching `x-cron-secret` header IN ADDITION to the
   *  existing session check. Backward-compatible: unset = no extra gate. */
  cronSecret: process.env.CRON_SECRET ?? "",
};

/**
 * M15 — env fail-fast. A `?? ""` default turns a missing secret into a silent
 * mis-configuration that only surfaces as a confusing runtime error (or, worse,
 * a degraded-but-billing code path). validateEnv classifies config and, in
 * production, refuses to boot when something required is absent. Non-production
 * only warns, so dev/test stays runnable with a partial env.
 */
export function validateEnv(): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Hard-required: the server cannot serve authenticated traffic without these.
  const required: Array<[string, string]> = [
    ["JWT_SECRET", ENV.cookieSecret],
    ["DATABASE_URL", ENV.databaseUrl],
    ["OAUTH_SERVER_URL", ENV.oAuthServerUrl],
    ["VITE_APP_ID", ENV.appId],
    // Required so owner-only routes fail closed at boot rather than silently
    // downgrading to "any admin" at runtime (see ownerProcedure in routers.ts).
    ["OWNER_OPEN_ID", ENV.ownerOpenId],
  ];
  for (const [name, val] of required) {
    if (!val) errors.push(`${name} is required but missing`);
  }

  // Conditional hard-requirement: opting into the SAM2 mask provider without its
  // credentials is exactly the silent mis-config that motivated this guard — the
  // sam2 path would fail per-request instead of refusing to boot.
  if (ENV.maskProvider === "sam2") {
    if (!ENV.replicateApiToken) errors.push("STUDIO_MASK_PROVIDER=sam2 requires REPLICATE_API_TOKEN");
    if (!ENV.replicateSam2Model) errors.push("STUDIO_MASK_PROVIDER=sam2 requires REPLICATE_SAM2_MODEL");
  }

  // Feature-degrading: present-but-empty means that feature is dark. Warn only.
  const optional: Array<[string, string, string]> = [
    ["STRIPE_SECRET_KEY", ENV.stripeSecretKey, "billing/checkout"],
    ["STRIPE_WEBHOOK_SECRET", ENV.stripeWebhookSecret, "Stripe webhook verification"],
    ["RESEND_API_KEY", ENV.resendApiKey, "transactional email"],
    ["BUILT_IN_FORGE_API_URL", ENV.forgeApiUrl, "Forge LLM/image generation"],
    ["BUILT_IN_FORGE_API_KEY", ENV.forgeApiKey, "Forge LLM/image generation"],
  ];
  for (const [name, val, feature] of optional) {
    if (!val) warnings.push(`${name} missing — ${feature} disabled`);
  }

  return { errors, warnings };
}

/**
 * Call once at boot. In production, throws if any required env is missing so the
 * process exits instead of serving a half-configured app. Elsewhere, logs.
 */
export function assertEnvOrExit(): void {
  const { errors, warnings } = validateEnv();
  for (const w of warnings) console.warn(`[env] ${w}`);
  if (errors.length === 0) return;
  for (const e of errors) console.error(`[env] ${e}`);
  if (ENV.isProduction) {
    throw new Error(`Missing required environment configuration:\n  - ${errors.join("\n  - ")}`);
  }
  console.warn("[env] continuing despite missing config (non-production)");
}
