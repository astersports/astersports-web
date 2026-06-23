import { int, mysqlEnum, mysqlTable, text, timestamp, varchar, boolean, json, bigint, index, uniqueIndex } from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 * Extend this file with additional tables as your product grows.
 * Columns use camelCase to match both database fields and generated types.
 */
export const users = mysqlTable("users", {
  /**
   * Surrogate primary key. Auto-incremented numeric value managed by the database.
   * Use this for relations between tables.
   */
  id: int("id").autoincrement().primaryKey(),
  /** Manus OAuth identifier (openId) returned from the OAuth callback. Unique per user. */
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  /** Hashed password for email/password auth (null for OAuth-only users). */
  passwordHash: varchar("passwordHash", { length: 255 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  /** Subscription tier (e.g. "free", "pro", "enterprise"). */
  subscriptionType: varchar("subscriptionType", { length: 64 }),
  /** FK to an organization/team table (null for individual users). */
  organizationId: int("organizationId"),
  /** Whether the account is active (false = suspended/deactivated). */
  isActive: boolean("isActive").notNull().default(true),
  /** Whether the user's email address has been verified. */
  emailVerified: boolean("emailVerified").notNull().default(false),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/**
 * AAU Basketball — Games table
 * Stores every scraped game from the Zero Gravity circuit.
 */
export const games = mysqlTable("games", {
  id: int("id").autoincrement().primaryKey(),
  tournamentId: varchar("tournamentId", { length: 64 }).notNull(),
  /** Exposure Events game ID (for dedup) */
  externalId: varchar("externalId", { length: 128 }).notNull().unique(),
  homeTeam: varchar("homeTeam", { length: 255 }).notNull(),
  awayTeam: varchar("awayTeam", { length: 255 }).notNull(),
  homeScore: int("homeScore"),
  awayScore: int("awayScore"),
  /** true = Legacy Hoopers is the home team */
  isLegacyHome: boolean("isLegacyHome").notNull().default(true),
  /** ISO datetime string of the scheduled game time */
  scheduledTime: varchar("scheduledTime", { length: 64 }),
  /** e.g. "Final", "In Progress", "Scheduled" */
  status: varchar("status", { length: 32 }).default("Scheduled"),
  /** Court / location info */
  court: varchar("court", { length: 128 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Game = typeof games.$inferSelect;
export type InsertGame = typeof games.$inferInsert;

/**
 * AAU Basketball — Scraper cache table
 * Tracks last scrape time per tournament to avoid redundant fetches.
 */
export const scraperCache = mysqlTable("scraper_cache", {
  id: int("id").autoincrement().primaryKey(),
  tournamentId: varchar("tournamentId", { length: 64 }).notNull().unique(),
  lastScrapedAt: timestamp("lastScrapedAt").defaultNow().notNull(),
  /** Raw JSON response cached for quick reads */
  cachedData: json("cachedData"),
  /** Number of games found in last scrape */
  gameCount: int("gameCount").default(0),
});

export type ScraperCache = typeof scraperCache.$inferSelect;
export type InsertScraperCache = typeof scraperCache.$inferInsert;

/**
 * Billing — Clients table
 * Stores Stripe customer/subscription info for each billing client.
 */
export const billingClients = mysqlTable("billing_clients", {
  id: int("id").autoincrement().primaryKey(),
  /** Client display name (e.g. "St. Patrick's Church") */
  name: varchar("name", { length: 255 }).notNull(),
  /** Client email for Stripe invoices */
  email: varchar("email", { length: 320 }).notNull(),
  /** Stripe Customer ID (cus_xxx) */
  stripeCustomerId: varchar("stripeCustomerId", { length: 128 }).notNull().unique(),
  /** Stripe Subscription ID (sub_xxx) — null if no active subscription */
  stripeSubscriptionId: varchar("stripeSubscriptionId", { length: 128 }),
  /** Subscription status from Stripe (active, past_due, canceled, etc.) */
  subscriptionStatus: varchar("subscriptionStatus", { length: 32 }).default("none"),
  /** Optional notes about the client */
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type BillingClient = typeof billingClients.$inferSelect;
export type InsertBillingClient = typeof billingClients.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────
// Print Studio — Multi-tenant tables
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Categories group tenants (e.g. "Fashion Design").
 */
export const categories = mysqlTable("categories", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 128 }).notNull(),
  slug: varchar("slug", { length: 128 }).notNull().unique(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Category = typeof categories.$inferSelect;
export type InsertCategory = typeof categories.$inferInsert;

/**
 * Tenants represent firms/organizations. Each has a credit wallet.
 */
export const tenants = mysqlTable("tenants", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  slug: varchar("slug", { length: 128 }).notNull().unique(),
  categoryId: int("categoryId").notNull(),
  /** Account type: firm (multi-seat) or individual (single seat). */
  type: mysqlEnum("type", ["firm", "individual"]).default("firm").notNull(),
  plan: mysqlEnum("plan", ["none", "starter", "pro", "team"]).default("none").notNull(),
  creditBalance: int("creditBalance").default(0).notNull(),
  seats: int("seats").default(1).notNull(),
  /** Restrict membership to emails from this domain (null = open). */
  allowedEmailDomain: varchar("allowedEmailDomain", { length: 255 }),
  /** When the 7-day free trial started (null = no trial / already converted). */
  trialStartedAt: timestamp("trialStartedAt"),
  /** Credits granted at trial start (for tracking how much of the trial was used). */
  trialCredits: int("trialCredits").default(0).notNull(),
  /** Stripe Customer ID for this tenant. */
  stripeCustomerId: varchar("stripeCustomerId", { length: 128 }),
  /** Stripe Subscription ID for the active plan. */
  stripeSubscriptionId: varchar("stripeSubscriptionId", { length: 128 }),
  /** Stripe SetupIntent ID (used during trial to collect card on file). */
  stripeSetupIntentId: varchar("stripeSetupIntentId", { length: 128 }),
  /** Stripe PaymentMethod ID (stored after SetupIntent succeeds — used for Day 7 auto-charge). */
  stripePaymentMethodId: varchar("stripePaymentMethodId", { length: 128 }),
  /** When the trial was converted to a paid plan (null = still in trial or never converted). */
  trialConvertedAt: timestamp("trialConvertedAt"),
  /** Credits frozen on trial cancel (restored if re-subscribe within 90 days). */
  trialFrozenCredits: int("trialFrozenCredits").default(0).notNull(),
  /** When credits were frozen (for 90-day expiry calculation). */
  trialFrozenAt: timestamp("trialFrozenAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Tenant = typeof tenants.$inferSelect;
export type InsertTenant = typeof tenants.$inferInsert;

/**
 * Memberships link users to tenants with role-based access.
 */
export const memberships = mysqlTable("memberships", {
  id: int("id").autoincrement().primaryKey(),
  tenantId: int("tenantId").notNull(),
  userId: int("userId").notNull(),
  role: mysqlEnum("role", ["owner", "admin", "member"]).default("member").notNull(),
  status: mysqlEnum("status", ["active", "invited", "disabled"]).default("active").notNull(),
  /** For invited stubs where the user hasn't signed up yet. */
  invitedEmail: varchar("invitedEmail", { length: 320 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (t) => ({
  // H5: getMembership(tenantId, userId) is on the auth hot path (storage-proxy
  // access checks, every tenant-scoped mutation).
  tenantUserIdx: index("idx_memberships_tenant_user").on(t.tenantId, t.userId),
}));

export type Membership = typeof memberships.$inferSelect;
export type InsertMembership = typeof memberships.$inferInsert;

/**
 * Append-only credit ledger for tenant wallets.
 */
export const creditLedger = mysqlTable("credit_ledger", {
  id: int("id").autoincrement().primaryKey(),
  tenantId: int("tenantId").notNull(),
  userId: int("userId"),
  /** Positive = credit, negative = debit. */
  delta: int("delta").notNull(),
  balanceAfter: int("balanceAfter").notNull(),
  /** e.g. "generation", "grant", "topup", "subscription", "adjustment" */
  reason: varchar("reason", { length: 64 }).notNull(),
  /** Optional reference ID (e.g. job ID, Stripe payment intent). */
  refId: varchar("refId", { length: 128 }),
  note: text("note"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (t) => ({
  // H5: every ledger read is tenant-scoped and ordered by recency. Also serves
  // firmAdmin.spendByMember's 7-day window scan (tenantId + createdAt range).
  tenantCreatedIdx: index("idx_credit_ledger_tenant_created").on(t.tenantId, t.createdAt),
  // M4a: covering index for firmAdmin.spendByMember's all-time aggregation
  // (WHERE tenantId=? GROUP BY userId, SUM over delta). userId follows tenantId
  // so groups are contiguous, and delta is covered — a tight index scan with no
  // table lookup or filesort instead of a full per-tenant ledger scan at scale.
  tenantUserDeltaIdx: index("idx_credit_ledger_tenant_user_delta").on(t.tenantId, t.userId, t.delta),
  // H5: ledger<->jobs correlation joins on refId.
  refIdIdx: index("idx_credit_ledger_refId").on(t.refId),
  // C3: hard idempotency backstop — at most one ledger row per (refId, reason).
  // MySQL allows multiple NULL refIds, so manual adjustments without a refId are
  // unaffected. grantCredits also checks-first, so the common retry path never
  // hits this constraint; it only catches the concurrent-delivery race.
  refReasonUniq: uniqueIndex("uniq_credit_ledger_ref_reason").on(t.refId, t.reason),
}));

export type CreditLedgerEntry = typeof creditLedger.$inferSelect;
export type InsertCreditLedgerEntry = typeof creditLedger.$inferInsert;

/**
 * Studio jobs — each upload/edit session.
 */
/** Pre-computed context the async worker needs to finish a SAM2 prediction WITHOUT re-running
 *  the (nondeterministic, costly) vision-LLM locate (ASYNC_GENERATION_SPEC §1). The crop geometry
 *  is produced at enqueue and stored as JSON on studio_jobs.predictionMeta. Structurally matches
 *  the masking layer's CropSegment geometry (bbox is BBoxNormalized-shaped). */
export interface PredictionMeta {
  bbox: { x: number; y: number; w: number; h: number };
  width: number;
  height: number;
  cropWidth: number;
  cropHeight: number;
  /** The per-attempt deduct refId (`job-<id>-a<N>`) recorded at enqueue so the async
   *  worker refunds the EXACT attempt that was charged (`<deductRef>-failed`), rather
   *  than a fixed `job-<id>-failed` that collides across regenerate attempts and leaves
   *  the 2nd+ attempt un-refunded. Optional: jobs enqueued before this field fall back
   *  to the legacy `job-<id>-failed` key in the worker. */
  deductRef?: string;
}

export const jobs = mysqlTable("studio_jobs", {
  id: int("id").autoincrement().primaryKey(),
  tenantId: int("tenantId").notNull(),
  userId: int("userId").notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  originalKey: varchar("originalKey", { length: 512 }).notNull(),
  originalUrl: varchar("originalUrl", { length: 1024 }).notNull(),
  /** JSON array of detected element names. */
  detectedElements: text("detectedElements"),
  /** JSON of last-used ControlSettings. */
  controls: text("controls"),
  /** Denormalized edit category derived from controls at write time:
   *  'recolor'|'scale'|'density'|'remove'|'mixed'|'none'. Powers the History
   *  "Top Edit Type" tile without scanning the controls TEXT column. */
  editType: varchar("editType", { length: 16 }),
  /** Natural-language instruction sent to AI. */
  instruction: text("instruction"),
  /** Async-generation lifecycle (ASYNC_GENERATION_SPEC §1). The two async-refactor states
   *  sam2_processing (awaiting the Replicate prediction) and cpu_processing (running the
   *  deterministic density/scale ops) are APPENDED to the enum — not inserted mid-list — so
   *  existing rows' ENUM ordinals are untouched by the ALTER. Terminal states stay done|failed
   *  (a refund is a failed row + a credit_ledger refund row; no separate `refunded` state). */
  status: mysqlEnum("status", ["pending", "processing", "done", "failed", "sam2_processing", "cpu_processing"]).default("pending").notNull(),
  creditsUsed: int("creditsUsed").default(0),
  /** Error message when job fails (async density/scale/recolor). */
  errorMessage: text("errorMessage"),
  /** Replicate prediction id (ASYNC_GENERATION_SPEC §1-§2). Set at enqueue via
   *  predictions.create(); the webhook + cron poller resolve the job by it. */
  predictionId: varchar("predictionId", { length: 255 }),
  /** When the async prediction was enqueued — drives the reaper's max-prediction-age sweep. */
  enqueuedAt: timestamp("enqueuedAt"),
  /** Async-worker crop geometry (ASYNC_GENERATION_SPEC §1) — set at enqueue, consumed by
   *  finishSam2Segmentation in the worker so it never re-runs the vision-LLM locate. JSON for
   *  forward flexibility (e.g. future upscale context). */
  predictionMeta: json("predictionMeta").$type<PredictionMeta>(),
  /** T1.3: Poison-pill cap — incremented each time the cron poller picks up this job.
   *  At >= MAX_POLL_ATTEMPTS the worker terminates with failAndRefund(poison_pill). */
  pollAttempts: int("pollAttempts").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (t) => ({
  // H5: tenant job lists filter by tenantId and sort by createdAt DESC.
  tenantCreatedIdx: index("idx_studio_jobs_tenant_created").on(t.tenantId, t.createdAt),
}));

export type Job = typeof jobs.$inferSelect;
export type InsertJob = typeof jobs.$inferInsert;

/**
 * Variations generated for a job (each round may have 1-4 images).
 */
export const jobVariations = mysqlTable("studio_job_variations", {
  id: int("id").autoincrement().primaryKey(),
  jobId: int("jobId").notNull(),
  tenantId: int("tenantId").notNull(),
  resultKey: varchar("resultKey", { length: 512 }).notNull(),
  resultUrl: varchar("resultUrl", { length: 1024 }).notNull(),
  round: int("round").default(1).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (t) => ({
  // H5: variations are always fetched by their parent jobId.
  jobIdx: index("idx_studio_job_variations_jobId").on(t.jobId),
}));

export type JobVariation = typeof jobVariations.$inferSelect;
export type InsertJobVariation = typeof jobVariations.$inferInsert;

/**
 * Idempotency log for processed Stripe webhook events.
 * Stripe delivers at-least-once and retries; the primary key prevents
 * double-processing (e.g. duplicate credit grants on a retried invoice.paid).
 */
export const stripeEvents = mysqlTable("stripe_events", {
  id: varchar("id", { length: 255 }).primaryKey(),
  type: varchar("type", { length: 128 }).notNull(),
  processedAt: timestamp("processedAt").defaultNow().notNull(),
});

export type StripeEvent = typeof stripeEvents.$inferSelect;
export type InsertStripeEvent = typeof stripeEvents.$inferInsert;

/**
 * Favorites/pinned jobs — tenants can star their best results for quick access.
 */
export const jobFavorites = mysqlTable("studio_job_favorites", {
  id: int("id").autoincrement().primaryKey(),
  jobId: int("jobId").notNull(),
  tenantId: int("tenantId").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (t) => ({
  // H5: favorites are listed per tenant and toggled by (tenantId, jobId).
  tenantJobIdx: index("idx_studio_job_favorites_tenant_job").on(t.tenantId, t.jobId),
}));

export type JobFavorite = typeof jobFavorites.$inferSelect;
export type InsertJobFavorite = typeof jobFavorites.$inferInsert;

/**
 * Per-tenant rollup of History dashboard aggregates (total jobs, credits spent,
 * done jobs). Recomputed from `studio_jobs` on read when stale — no cron, no
 * write-path coupling; the tile reader falls back to a live aggregate if this
 * table isn't present yet.
 */
export const tenantStats = mysqlTable("studio_tenant_stats", {
  tenantId: int("tenantId").primaryKey(),
  totalJobs: int("totalJobs").default(0).notNull(),
  creditsSpent: int("creditsSpent").default(0).notNull(),
  doneJobs: int("doneJobs").default(0).notNull(),
  computedAt: timestamp("computedAt").defaultNow().notNull(),
});

export type TenantStats = typeof tenantStats.$inferSelect;
export type InsertTenantStats = typeof tenantStats.$inferInsert;

/**
 * Server-side structured logs for production debugging.
 * Captures generation pipeline events, errors, and audit trail.
 */
export const serverLogs = mysqlTable("server_logs", {
  id: int("id").autoincrement().primaryKey(),
  /** Log level: info, warn, error, debug */
  level: mysqlEnum("level", ["debug", "info", "warn", "error"]).default("info").notNull(),
  /** Source module/function (e.g. "density", "scale", "sam2", "recolor", "webhook") */
  source: varchar("source", { length: 64 }).notNull(),
  /** Human-readable message */
  message: varchar("message", { length: 1024 }).notNull(),
  /** Structured metadata (error details, timings, input params) */
  metadata: json("metadata"),
  /** Associated job ID (nullable for non-job events) */
  jobId: int("jobId"),
  /** Associated tenant ID (nullable for system events) */
  tenantId: int("tenantId"),
  /** Associated user ID */
  userId: int("userId"),
  /** Duration in ms (for timing events) */
  durationMs: int("durationMs"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (t) => ({
  // Query patterns: filter by tenant, source, level; sort by recency
  tenantCreatedIdx: index("idx_server_logs_tenant_created").on(t.tenantId, t.createdAt),
  sourceIdx: index("idx_server_logs_source").on(t.source, t.createdAt),
  levelIdx: index("idx_server_logs_level").on(t.level, t.createdAt),
  jobIdx: index("idx_server_logs_job").on(t.jobId),
}));

export type ServerLog = typeof serverLogs.$inferSelect;
export type InsertServerLog = typeof serverLogs.$inferInsert;

/**
 * Platform administrators — super_admin users who operate above all tenant accounts.
 * Kept separate from memberships so they never appear in customer member lists.
 */
export const platformAdmins = mysqlTable("platform_admins", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().unique(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type PlatformAdmin = typeof platformAdmins.$inferSelect;
export type InsertPlatformAdmin = typeof platformAdmins.$inferInsert;

/**
 * Invite Links — shareable tokens for self-service signup.
 * Supports three flows:
 *   - "firm": recipient becomes owner of a new pre-configured firm
 *   - "individual": recipient gets a single-seat individual account
 *   - "join": recipient joins an existing tenant as a member
 */
export const inviteLinks = mysqlTable("invite_links", {
  id: int("id").autoincrement().primaryKey(),
  /** Unique token used in the invite URL (/join/:token). */
  token: varchar("token", { length: 64 }).notNull().unique(),
  /** Type of invite: firm (create org), individual (create solo account), join (join existing tenant). */
  type: mysqlEnum("type", ["firm", "individual", "join"]).notNull(),
  /** Status tracking. */
  status: mysqlEnum("status", ["active", "redeemed", "expired", "revoked"]).default("active").notNull(),
  /** For "join" type: the tenant to join. For "firm"/"individual": null (created on redeem). */
  tenantId: int("tenantId"),
  /** Pre-configured metadata (JSON): plan, seats, credits, firmName, domainLock, role, etc. */
  metadata: json("metadata"),
  /** Max number of times this link can be redeemed (null = unlimited). */
  maxUses: int("maxUses"),
  /** How many times this link has been redeemed. */
  useCount: int("useCount").default(0).notNull(),
  /** When the link expires (null = never). */
  expiresAt: timestamp("expiresAt"),
  /** Who created this link (platform admin or tenant admin). */
  createdBy: int("createdBy").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  /** Last time the link was redeemed. */
  lastRedeemedAt: timestamp("lastRedeemedAt"),
});
export type InviteLink = typeof inviteLinks.$inferSelect;
export type InsertInviteLink = typeof inviteLinks.$inferInsert;

/**
 * Invite link redemptions — tracks who redeemed each link.
 */
export const inviteLinkRedemptions = mysqlTable("invite_link_redemptions", {
  id: int("id").autoincrement().primaryKey(),
  inviteLinkId: int("inviteLinkId").notNull(),
  userId: int("userId").notNull(),
  /** The tenant that was created or joined as a result. */
  tenantId: int("tenantId").notNull(),
  redeemedAt: timestamp("redeemedAt").defaultNow().notNull(),
});
export type InviteLinkRedemption = typeof inviteLinkRedemptions.$inferSelect;
export type InsertInviteLinkRedemption = typeof inviteLinkRedemptions.$inferInsert;
