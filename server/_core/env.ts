export const ENV = {
  appId: process.env.VITE_APP_ID ?? "",
  cookieSecret: process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? process.env.VITE_OWNER_OPEN_ID ?? "",
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
  /** Anthropic (Claude) vision LLM — fabric-region locate, element detection, and
   *  the no-op QA judge (server/_core/llm.ts). Replaces the Manus forge LLM gateway.
   *  Absent key => invokeLLM throws at call time; the locate path degrades to
   *  DEFAULT_REGION rather than crashing, so it warns at boot, never blocks. */
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? "",
  /** Vision model id. Default Claude Opus 4.8 (best vision). Set ANTHROPIC_MODEL
   *  to e.g. claude-haiku-4-5 to trade some accuracy for ~5x lower per-call cost
   *  on the locate/detect/judge calls — an env flip, no code change. */
  anthropicModel:
    process.env.ANTHROPIC_MODEL && process.env.ANTHROPIC_MODEL.trim().length > 0
      ? process.env.ANTHROPIC_MODEL.trim()
      : "claude-opus-4-8",
  /** Landing "Aster Scout" agent model (docs/SPEC_LANDING_AGENT.txt, Fork B1).
   *  Separate from anthropicModel (the vision default, Opus): the public-page
   *  concierge does grounded FAQ + routing, which Haiku handles at a fraction of
   *  the cost. Override via ANTHROPIC_AGENT_MODEL. Read only when the agent ships
   *  (P3); inert today. */
  anthropicAgentModel:
    process.env.ANTHROPIC_AGENT_MODEL && process.env.ANTHROPIC_AGENT_MODEL.trim().length > 0
      ? process.env.ANTHROPIC_AGENT_MODEL.trim()
      : "claude-haiku-4-5",
  /** Landing "Aster Scout" agent kill switch (docs/SPEC_LANDING_AGENT.txt).
   *  Default DARK: the model-backed agent endpoint stays off until Frank flips
   *  this on an Architect-verified SHA after the §5 abuse/cost envelope (P2) and
   *  the bot gate (P5) land. NOT on the money/credit path, but it IS a
   *  sub-processor + spend gate, so it ships dark and the flip is Frank's (§1
   *  human-on-flip). Nothing reads it yet (P0 scaffolding). */
  landingAgentLive: process.env.LANDING_AGENT_LIVE === "true",
  /** P2 abuse/cost envelope for the landing agent (docs/SPEC_LANDING_AGENT.txt §5,
   *  conditions C2/C3). All have safe defaults; Frank tunes the ceiling to his
   *  daily $ budget at flip time. Read by server/_core/landingAgent/* — inert
   *  until the agent endpoint ships (P3).
   *
   *  The global ceiling is a $/day budget converted to a token budget via a
   *  blended $/million-tokens cost knob. That knob is an INTERNAL cost estimate,
   *  not a customer-facing price (so it is outside condition C1). Metering is in
   *  tokens (what the model bills); dollars are the operator-facing view. */
  landingAgentDailyUsdCeiling:
    Number(process.env.LANDING_AGENT_DAILY_USD_CEILING) > 0
      ? Number(process.env.LANDING_AGENT_DAILY_USD_CEILING)
      : 5,
  /** Blended internal $/million-tokens estimate used only to convert the $ ceiling
   *  into a token budget. Tune if Haiku pricing or the in/out mix changes. */
  landingAgentUsdPerMtok:
    Number(process.env.LANDING_AGENT_USD_PER_MTOK) > 0
      ? Number(process.env.LANDING_AGENT_USD_PER_MTOK)
      : 1.5,
  /** Per-identity (per-IP) daily token cap — condition C3. No single actor can
   *  consume more than this slice of the global budget, so one abuser can't trip
   *  the global ceiling and deny every real visitor for the day. */
  landingAgentIdentityTokenCap:
    Number(process.env.LANDING_AGENT_IDENTITY_TOKEN_CAP) > 0
      ? Number(process.env.LANDING_AGENT_IDENTITY_TOKEN_CAP)
      : 30_000,
  /** Chat rate limits — messages per session and per IP/hour (sliding window). */
  landingAgentChatPerSession:
    Number(process.env.LANDING_AGENT_CHAT_PER_SESSION) > 0
      ? Number(process.env.LANDING_AGENT_CHAT_PER_SESSION)
      : 8,
  landingAgentChatPerIpHour:
    Number(process.env.LANDING_AGENT_CHAT_PER_IP_HOUR) > 0
      ? Number(process.env.LANDING_AGENT_CHAT_PER_IP_HOUR)
      : 20,
  /** Lead-capture cap — submissions per IP/day, SEPARATE from the chat limit
   *  (condition C2a): capture_lead is a public email-send primitive, rate-limited
   *  hard and independently so it can't be used to flood frank@. */
  landingAgentLeadPerIpDay:
    Number(process.env.LANDING_AGENT_LEAD_PER_IP_DAY) > 0
      ? Number(process.env.LANDING_AGENT_LEAD_PER_IP_DAY)
      : 3,
  /** Supabase Storage — customer image uploads + signed reads (server/storage.ts,
   *  server/_core/storageProxy.ts). Replaces the Manus Forge presigned-URL/S3 path.
   *  The bucket is PRIVATE; the browser never talks to Supabase directly — it goes
   *  through /manus-storage/{key}, which auth-checks (tenant isolation) then 307s to
   *  a short-lived server-signed URL. SUPABASE_URL is the project URL; the
   *  service-role key is server-only (bypasses RLS) — never ships to the client. */
  supabaseUrl: process.env.SUPABASE_URL ?? "",
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
  supabaseStorageBucket:
    process.env.SUPABASE_STORAGE_BUCKET && process.env.SUPABASE_STORAGE_BUCKET.trim().length > 0
      ? process.env.SUPABASE_STORAGE_BUCKET.trim()
      : "media",
  /** Google OAuth 2.0 — the identity provider that replaces the Manus WebDev auth
   *  server. Sessions stay our own JWT (cookieSecret); Google only verifies who the
   *  user is. Client secret is server-only (token exchange) — never shipped to the
   *  client. Absent => the Google login route 503s (no silent insecure fallback). */
  googleClientId: process.env.GOOGLE_CLIENT_ID ?? "",
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
  stripeSecretKey: process.env.STRIPE_SECRET_KEY ?? "",
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? "",
  resendApiKey: process.env.RESEND_API_KEY ?? "",
  /** Manus Agent API (api.manus.ai) — optional outbound integration. Ships DARK:
   *  an absent key disables it (the client throws ManusUnavailableError). This is
   *  NOT a `*_LIVE` flag and NOT on the money/credit path — it gates an inert
   *  client only, so it warns (feature-degrading), never blocks boot. */
  manusApiKey: process.env.MANUS_API_KEY ?? "",
  manusApiBaseUrl: process.env.MANUS_API_BASE_URL ?? "https://api.manus.ai",
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
   *  densityThin. Requires SAM2 (raster + instances). Default off. When on,
   *  studioEngine.runVariation selects this op over v1 densityThin on the live density
   *  money path; when off, density runs v1. The flag flip stays Frank's (§1
   *  human-on-flip). Patterned on studioDensityLive. */
  studioDensityRedistribute: process.env.STUDIO_DENSITY_REDISTRIBUTE === "true",
  /** T2.1: LaMa texture-aware infill. When true, density ops use Replicate's LaMa
   *  inpainting model instead of flat LAB fill. Requires sub-processor disclosure
   *  (Replicate DPA + privacy policy update) before activation in production.
   *  Default off — Flip-Authority-governed (CLAUDE.md §1). */
  studioLamaLive: process.env.STUDIO_LAMA_LIVE === "true",
  /** Self-serve org creation (`tenants.create`). Mints TRIAL_CREDITS through the
   *  ledger-safe `grantCredits` path and is per-user rate-limited. Default off —
   *  this is the Flip-Authority-governed money-path flip (CLAUDE.md §1). It gates
   *  the credit-minting tRPC procedure itself; the client `VITE_CREATE_ORG_LIVE`
   *  only un-disables the dialog button (a direct API call still hits this gate).
   *  Unlike scale/density it has NO sam2/raster co-requirement, so validateEnv
   *  adds no boot guard for it. */
  studioCreateOrgLive: process.env.STUDIO_CREATE_ORG_LIVE === "true",
  /** Async generation processor (ASYNC_GENERATION_SPEC). When on, density/scale jobs enqueue +
   *  run via the Replicate-async worker (webhook + cron poll) instead of the synchronous SSE
   *  path, so the 45-120s SAM2 run lives off our 60s-capped request. Architecture toggle, NOT a
   *  money-path *_LIVE flag (billing is unchanged) — kept out of the /posture `dark` calc.
   *  Default off; lands DARK, parallel to the SSE path, until verified. The flip stays Frank's. */
  studioAsyncJobs: process.env.STUDIO_ASYNC_JOBS === "true",
  /** Replicate SAM2 (D1 = Option 2). Token + model-version id for the hosted mask source. */
  replicateApiToken: process.env.REPLICATE_API_TOKEN ?? "",
  replicateSam2Model: process.env.REPLICATE_SAM2_MODEL ?? "",
  /** Replicate webhook signing secret (svix-style HMAC) for /api/webhooks/replicate
   *  (ASYNC_GENERATION_SPEC §3). Env-based per §6; the webhook is fail-closed when unset. */
  replicateWebhookSecret: process.env.REPLICATE_WEBHOOK_SECRET ?? "",
  /** H6: upper bound on a source image's total pixel count for the deterministic
   *  ops. A decoded RGBA frame costs width*height*4 bytes, so an unbounded upload
   *  is a memory-exhaustion vector. 40 MP (~160 MB RGBA) covers real print artwork
   *  with headroom; raise via STUDIO_MAX_MEGAPIXELS only with the memory budget in mind. */
  studioMaxMegapixels: Number(process.env.STUDIO_MAX_MEGAPIXELS) > 0 ? Number(process.env.STUDIO_MAX_MEGAPIXELS) : 40,
  /** T1.6: WORKING-resolution cap (megapixels) for the deterministic ops. Distinct from the
   *  REJECT cap above: this DOWNSCALES (preserves aspect) rather than rejecting. The density op
   *  holds the image RGBA + up to STUDIO_MAX_INSTANCES full-frame motif masks at once, so at full
   *  print resolution it OOM-kills the process mid-op on a small instance (the job strands → the
   *  reaper refunds → no result). Applied at the single decodeUpright boundary, so the image AND
   *  every SAM2-derived mask (remapped to these dims) stay aligned. Default 2 MP fits a ~512 MB
   *  box for typical motif counts; RAISE via STUDIO_WORKING_MEGAPIXELS (e.g. 8–10) on a larger
   *  instance for full-resolution output. 0 disables the cap. */
  studioWorkingMegapixels: Number(process.env.STUDIO_WORKING_MEGAPIXELS) > 0 ? Number(process.env.STUDIO_WORKING_MEGAPIXELS) : 2,
  /** H6: max concurrent sharp decodes. Each decode holds a full RGBA frame in
   *  memory; without a cap, N simultaneous jobs multiply the peak. Default 4. */
  studioMaxConcurrentDecodes: Number(process.env.STUDIO_MAX_CONCURRENT_DECODES) > 0 ? Number(process.env.STUDIO_MAX_CONCURRENT_DECODES) : 4,
  /** SAM2 automatic-mask sampling density — the DOMINANT cost of a density job.
   *  64 (~4096 points) routinely runs 60-120s; 32 (~1024 points) ~4x faster; 16
   *  (~256 points) ~16x faster than 64 and sufficient for count-based thinning.
   *  Request timeout raised to 180s (platform cap); default lowered to 16 to keep
   *  typical density jobs well under 30s. Tune via STUDIO_SAM2_POINTS_PER_SIDE. */
  studioSam2PointsPerSide: Number(process.env.STUDIO_SAM2_POINTS_PER_SIDE) > 0 ? Number(process.env.STUDIO_SAM2_POINTS_PER_SIDE) : 16,
  /** SAM2 mask-to-mask refinement pass (~2x latency). Density fills the whole crop
   *  and area-filters instances, so motif-edge precision isn't needed — default off
   *  for speed. Set STUDIO_SAM2_USE_M2M=true to re-enable. */
  studioSam2UseM2m: process.env.STUDIO_SAM2_USE_M2M === "true",
  /** Cap on detected instances handed to the density ops. Each instance is remapped
   *  to a full-image raster, so a pathological SAM2 over-segmentation is an OOM
   *  vector; density only needs a representative motif set. Default 200; tune via
   *  STUDIO_MAX_INSTANCES. */
  studioMaxInstances: Number(process.env.STUDIO_MAX_INSTANCES) > 0 ? Number(process.env.STUDIO_MAX_INSTANCES) : 200,
  /** T1.4: In-worker wall-clock deadline (ms). The cron poller has a ~60s execution cap;
   *  the deadline must be BELOW that so a slow job fails+refunds internally rather than
   *  being hard-killed and stranding the charge. Default 45s (15s margin). */
  studioWorkerDeadlineMs: Number(process.env.STUDIO_WORKER_DEADLINE_MS) > 0 ? Number(process.env.STUDIO_WORKER_DEADLINE_MS) : 45_000,
  /** T1.3: poison-pill poll-count cap. A wedged prediction re-polls until the reaper, burning
   *  API calls; cap the polls. Paired with studioMaxPredictionAgeMs so a slow-but-healthy
   *  prediction isn't false-failed at the ~10s cron cadence. Default 5; tune via STUDIO_MAX_POLL_ATTEMPTS. */
  studioMaxPollAttempts: Number(process.env.STUDIO_MAX_POLL_ATTEMPTS) > 0 ? Number(process.env.STUDIO_MAX_POLL_ATTEMPTS) : 5,
  /** T1.3: max expected async-prediction lifetime (ms). The poison-pill fires only once a job is
   *  BOTH past the poll cap AND older than this — above the ~120s SAM2 run timeout so a legitimately
   *  slow prediction completes (or Replicate times it out) before we give up. Default 150s. */
  studioMaxPredictionAgeMs: Number(process.env.STUDIO_MAX_PREDICTION_AGE_MS) > 0 ? Number(process.env.STUDIO_MAX_PREDICTION_AGE_MS) : 150_000,
  /** T1.5: staleness (ms) after which a job stuck in `cpu_processing` is treated as STRANDED
   *  (its worker container was hard-killed mid-op, so the 45s in-process deadline died with it)
   *  and reset to `sam2_processing` for a fresh container to RETRY — instead of waiting for the
   *  10-min reaper to merely refund. MUST exceed studioWorkerDeadlineMs so a still-alive worker
   *  (which always resolves within its own deadline) is never reset out from under itself.
   *  Default 60s. Tune via STUDIO_CPU_STALE_MS. */
  studioCpuStaleMs: Number(process.env.STUDIO_CPU_STALE_MS) > 0 ? Number(process.env.STUDIO_CPU_STALE_MS) : 60_000,
  /** H2: allowlist of host[:port] values the OAuth redirect target may use. When
   *  set (comma-separated), a decoded `state` redirect whose host is not on the
   *  list is rejected — the anti-code-interception control. Empty = scheme/format
   *  validation only. */
  oauthAllowedRedirectHosts: (process.env.OAUTH_ALLOWED_REDIRECT_HOSTS ?? "")
    .split(",")
    .map((h) => h.trim())
    .filter(Boolean),
  /** H3: shared secret for server-to-server scheduled (cron) endpoints. Post-Manus
   *  this is the SOLE gate on /api/scheduled/* (the Manus isCron session check was
   *  removed) — so in production it must be set or the endpoints fail closed. */
  cronSecret: process.env.CRON_SECRET ?? "",
  /** In-process scheduler (replaces the Manus Heartbeat). When true, the running
   *  app triggers its own /api/scheduled/* endpoints on intervals (self-HTTP with
   *  CRON_SECRET). Off by default so dev/CI/tests never schedule; set
   *  ENABLE_SCHEDULER=true on exactly one running instance in prod. */
  schedulerEnabled: process.env.ENABLE_SCHEDULER === "true",
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
    // Google OAuth is the sole identity provider since the Railway/Supabase
    // migration retired the Manus OAuth server (OAUTH_SERVER_URL). Without these
    // no user can authenticate, so they gate boot exactly as OAUTH_SERVER_URL did
    // before — failing fast beats booting green with every login 503ing.
    ["GOOGLE_CLIENT_ID", ENV.googleClientId],
    ["GOOGLE_CLIENT_SECRET", ENV.googleClientSecret],
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

  // Inverse guard: the deterministic scale/density ops consume SAM2 rasters +
  // instances; the classical provider can't serve them, so a live flag without
  // sam2 would deduct, call out, and refund on every request (charge-for-nothing).
  // Fail fast at boot instead of per-request.
  if (
    (ENV.studioScaleLive || ENV.studioDensityLive || ENV.studioDensityRedistribute) &&
    ENV.maskProvider !== "sam2"
  ) {
    errors.push(
      "STUDIO_SCALE_LIVE / STUDIO_DENSITY_LIVE / STUDIO_DENSITY_REDISTRIBUTE require STUDIO_MASK_PROVIDER=sam2 (deterministic ops need SAM2 rasters + instances)"
    );
  }

  // Feature-degrading: present-but-empty means that feature is dark. Warn only.
  const optional: Array<[string, string, string]> = [
    ["STRIPE_SECRET_KEY", ENV.stripeSecretKey, "billing/checkout"],
    ["STRIPE_WEBHOOK_SECRET", ENV.stripeWebhookSecret, "Stripe webhook verification"],
    ["RESEND_API_KEY", ENV.resendApiKey, "transactional email"],
    ["MANUS_API_KEY", ENV.manusApiKey, "Manus Agent API integration"],
    ["BUILT_IN_FORGE_API_URL", ENV.forgeApiUrl, "Forge LLM/image generation"],
    ["BUILT_IN_FORGE_API_KEY", ENV.forgeApiKey, "Forge LLM/image generation"],
    ["ANTHROPIC_API_KEY", ENV.anthropicApiKey, "Claude vision LLM (fabric locate / element detect / no-op judge)"],
    ["SUPABASE_URL", ENV.supabaseUrl, "Supabase Storage (image uploads / signed reads)"],
    ["SUPABASE_SERVICE_ROLE_KEY", ENV.supabaseServiceRoleKey, "Supabase Storage (image uploads / signed reads)"],
    ["CRON_SECRET", ENV.cronSecret, "scheduled cron endpoints (reaper/poll/billing) — gate fails closed in prod if unset"],
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
