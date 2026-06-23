import { pgTable, pgEnum, serial, integer, text, timestamp, varchar, boolean, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";

/**
 * MIGRATION (Railway + Supabase): this schema was ported from MySQL (drizzle-orm/mysql-core)
 * to Postgres (drizzle-orm/pg-core). Mapping: mysqlTable->pgTable, int().autoincrement()->serial,
 * mysqlEnum->pgEnum (named types declared once below), json->jsonb, varchar/text/boolean/timestamp
 * unchanged. Postgres has NO `ON UPDATE CURRENT_TIMESTAMP`, so `onUpdateNow()` is dropped here and
 * an `updatedAt` BEFORE-UPDATE trigger is added in the migration SQL to preserve the exact "any
 * write bumps updatedAt" semantics that recoverStrandedCpuJobs (T1.5) relies on. See
 * docs/RAILWAY_SUPABASE_MIGRATION_SCOPE.txt.
 */

// ── Named enum types (Postgres declares enums as standalone types) ──────────────
export const userRoleEnum = pgEnum("user_role", ["user", "admin"]);
export const tenantTypeEnum = pgEnum("tenant_type", ["firm", "individual"]);
export const tenantPlanEnum = pgEnum("tenant_plan", ["none", "starter", "pro", "team"]);
export const membershipRoleEnum = pgEnum("membership_role", ["owner", "admin", "member"]);
export const membershipStatusEnum = pgEnum("membership_status", ["active", "invited", "disabled"]);
export const jobStatusEnum = pgEnum("job_status", ["pending", "processing", "done", "failed", "sam2_processing", "cpu_processing"]);
export const logLevelEnum = pgEnum("log_level", ["debug", "info", "warn", "error"]);
export const inviteTypeEnum = pgEnum("invite_type", ["firm", "individual", "join"]);
export const inviteStatusEnum = pgEnum("invite_status", ["active", "redeemed", "expired", "revoked"]);

/**
 * Core user table backing auth flow.
 * Columns use camelCase to match both database fields and generated types.
 */
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  /** OAuth identifier (openId) returned from the OAuth callback. Unique per user. */
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  /** Hashed password for email/password auth (null for OAuth-only users). */
  passwordHash: varchar("passwordHash", { length: 255 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: userRoleEnum("role").default("user").notNull(),
  /** Subscription tier (e.g. "free", "pro", "enterprise"). */
  subscriptionType: varchar("subscriptionType", { length: 64 }),
  /** FK to an organization/team table (null for individual users). */
  organizationId: integer("organizationId"),
  /** Whether the account is active (false = suspended/deactivated). */
  isActive: boolean("isActive").notNull().default(true),
  /** Whether the user's email address has been verified. */
  emailVerified: boolean("emailVerified").notNull().default(false),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(), // trigger-maintained (see migration SQL)
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/**
 * AAU Basketball — Games table. Stores every scraped game from the Zero Gravity circuit.
 */
export const games = pgTable("games", {
  id: serial("id").primaryKey(),
  tournamentId: varchar("tournamentId", { length: 64 }).notNull(),
  /** Exposure Events game ID (for dedup) */
  externalId: varchar("externalId", { length: 128 }).notNull().unique(),
  homeTeam: varchar("homeTeam", { length: 255 }).notNull(),
  awayTeam: varchar("awayTeam", { length: 255 }).notNull(),
  homeScore: integer("homeScore"),
  awayScore: integer("awayScore"),
  /** true = Legacy Hoopers is the home team */
  isLegacyHome: boolean("isLegacyHome").notNull().default(true),
  /** ISO datetime string of the scheduled game time */
  scheduledTime: varchar("scheduledTime", { length: 64 }),
  /** e.g. "Final", "In Progress", "Scheduled" */
  status: varchar("status", { length: 32 }).default("Scheduled"),
  /** Court / location info */
  court: varchar("court", { length: 128 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(), // trigger-maintained
});

export type Game = typeof games.$inferSelect;
export type InsertGame = typeof games.$inferInsert;

/**
 * AAU Basketball — Scraper cache table. Tracks last scrape time per tournament.
 */
export const scraperCache = pgTable("scraper_cache", {
  id: serial("id").primaryKey(),
  tournamentId: varchar("tournamentId", { length: 64 }).notNull().unique(),
  lastScrapedAt: timestamp("lastScrapedAt").defaultNow().notNull(),
  /** Raw JSON response cached for quick reads */
  cachedData: jsonb("cachedData"),
  /** Number of games found in last scrape */
  gameCount: integer("gameCount").default(0),
});

export type ScraperCache = typeof scraperCache.$inferSelect;
export type InsertScraperCache = typeof scraperCache.$inferInsert;

/**
 * Billing — Clients table. Stores Stripe customer/subscription info per billing client.
 */
export const billingClients = pgTable("billing_clients", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  email: varchar("email", { length: 320 }).notNull(),
  stripeCustomerId: varchar("stripeCustomerId", { length: 128 }).notNull().unique(),
  stripeSubscriptionId: varchar("stripeSubscriptionId", { length: 128 }),
  subscriptionStatus: varchar("subscriptionStatus", { length: 32 }).default("none"),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(), // trigger-maintained
});

export type BillingClient = typeof billingClients.$inferSelect;
export type InsertBillingClient = typeof billingClients.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────
// Print Studio — Multi-tenant tables
// ─────────────────────────────────────────────────────────────────────────────

/** Categories group tenants (e.g. "Fashion Design"). */
export const categories = pgTable("categories", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 128 }).notNull(),
  slug: varchar("slug", { length: 128 }).notNull().unique(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Category = typeof categories.$inferSelect;
export type InsertCategory = typeof categories.$inferInsert;

/** Tenants represent firms/organizations. Each has a credit wallet. */
export const tenants = pgTable("tenants", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  slug: varchar("slug", { length: 128 }).notNull().unique(),
  categoryId: integer("categoryId").notNull(),
  type: tenantTypeEnum("type").default("firm").notNull(),
  plan: tenantPlanEnum("plan").default("none").notNull(),
  creditBalance: integer("creditBalance").default(0).notNull(),
  seats: integer("seats").default(1).notNull(),
  allowedEmailDomain: varchar("allowedEmailDomain", { length: 255 }),
  trialStartedAt: timestamp("trialStartedAt"),
  trialCredits: integer("trialCredits").default(0).notNull(),
  stripeCustomerId: varchar("stripeCustomerId", { length: 128 }),
  stripeSubscriptionId: varchar("stripeSubscriptionId", { length: 128 }),
  stripeSetupIntentId: varchar("stripeSetupIntentId", { length: 128 }),
  stripePaymentMethodId: varchar("stripePaymentMethodId", { length: 128 }),
  trialConvertedAt: timestamp("trialConvertedAt"),
  trialFrozenCredits: integer("trialFrozenCredits").default(0).notNull(),
  trialFrozenAt: timestamp("trialFrozenAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(), // trigger-maintained
});

export type Tenant = typeof tenants.$inferSelect;
export type InsertTenant = typeof tenants.$inferInsert;

/** Memberships link users to tenants with role-based access. */
export const memberships = pgTable("memberships", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenantId").notNull(),
  userId: integer("userId").notNull(),
  role: membershipRoleEnum("role").default("member").notNull(),
  status: membershipStatusEnum("status").default("active").notNull(),
  invitedEmail: varchar("invitedEmail", { length: 320 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (t) => ({
  tenantUserIdx: index("idx_memberships_tenant_user").on(t.tenantId, t.userId),
}));

export type Membership = typeof memberships.$inferSelect;
export type InsertMembership = typeof memberships.$inferInsert;

/** Append-only credit ledger for tenant wallets. */
export const creditLedger = pgTable("credit_ledger", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenantId").notNull(),
  userId: integer("userId"),
  /** Positive = credit, negative = debit. */
  delta: integer("delta").notNull(),
  balanceAfter: integer("balanceAfter").notNull(),
  reason: varchar("reason", { length: 64 }).notNull(),
  refId: varchar("refId", { length: 128 }),
  note: text("note"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (t) => ({
  tenantCreatedIdx: index("idx_credit_ledger_tenant_created").on(t.tenantId, t.createdAt),
  tenantUserDeltaIdx: index("idx_credit_ledger_tenant_user_delta").on(t.tenantId, t.userId, t.delta),
  refIdIdx: index("idx_credit_ledger_refId").on(t.refId),
  // C3: hard idempotency backstop — at most one ledger row per (refId, reason). Postgres,
  // like MySQL, allows multiple NULL refIds, so manual adjustments without a refId are
  // unaffected. grantCredits checks-first, so this only catches the concurrent-delivery race.
  refReasonUniq: uniqueIndex("uniq_credit_ledger_ref_reason").on(t.refId, t.reason),
}));

export type CreditLedgerEntry = typeof creditLedger.$inferSelect;
export type InsertCreditLedgerEntry = typeof creditLedger.$inferInsert;

/** Pre-computed context the async worker needs to finish a SAM2 prediction WITHOUT re-running
 *  the (nondeterministic, costly) vision-LLM locate (ASYNC_GENERATION_SPEC §1). */
export interface PredictionMeta {
  bbox: { x: number; y: number; w: number; h: number };
  width: number;
  height: number;
  cropWidth: number;
  cropHeight: number;
  /** The per-attempt deduct refId (`job-<id>-a<N>`) recorded at enqueue so the worker refunds
   *  the EXACT attempt charged (`<deductRef>-failed`). */
  deductRef?: string;
}

/** Studio jobs — each upload/edit session. */
export const jobs = pgTable("studio_jobs", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenantId").notNull(),
  userId: integer("userId").notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  originalKey: varchar("originalKey", { length: 512 }).notNull(),
  originalUrl: varchar("originalUrl", { length: 1024 }).notNull(),
  detectedElements: text("detectedElements"),
  controls: text("controls"),
  editType: varchar("editType", { length: 16 }),
  instruction: text("instruction"),
  /** Async-generation lifecycle (ASYNC_GENERATION_SPEC §1). */
  status: jobStatusEnum("status").default("pending").notNull(),
  creditsUsed: integer("creditsUsed").default(0),
  errorMessage: text("errorMessage"),
  predictionId: varchar("predictionId", { length: 255 }),
  /** When the async prediction was enqueued — drives the reaper's max-prediction-age sweep. */
  enqueuedAt: timestamp("enqueuedAt"),
  predictionMeta: jsonb("predictionMeta").$type<PredictionMeta>(),
  /** T1.3: Poison-pill cap — incremented each time the cron poller picks up this job. */
  pollAttempts: integer("pollAttempts").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(), // trigger-maintained (T1.5 stale-cpu detection reads this)
}, (t) => ({
  tenantCreatedIdx: index("idx_studio_jobs_tenant_created").on(t.tenantId, t.createdAt),
}));

export type Job = typeof jobs.$inferSelect;
export type InsertJob = typeof jobs.$inferInsert;

/** Variations generated for a job (each round may have 1-4 images). */
export const jobVariations = pgTable("studio_job_variations", {
  id: serial("id").primaryKey(),
  jobId: integer("jobId").notNull(),
  tenantId: integer("tenantId").notNull(),
  resultKey: varchar("resultKey", { length: 512 }).notNull(),
  resultUrl: varchar("resultUrl", { length: 1024 }).notNull(),
  round: integer("round").default(1).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (t) => ({
  jobIdx: index("idx_studio_job_variations_jobId").on(t.jobId),
}));

export type JobVariation = typeof jobVariations.$inferSelect;
export type InsertJobVariation = typeof jobVariations.$inferInsert;

/** Idempotency log for processed Stripe webhook events. */
export const stripeEvents = pgTable("stripe_events", {
  id: varchar("id", { length: 255 }).primaryKey(),
  type: varchar("type", { length: 128 }).notNull(),
  processedAt: timestamp("processedAt").defaultNow().notNull(),
});

export type StripeEvent = typeof stripeEvents.$inferSelect;
export type InsertStripeEvent = typeof stripeEvents.$inferInsert;

/** Favorites/pinned jobs — tenants can star their best results for quick access. */
export const jobFavorites = pgTable("studio_job_favorites", {
  id: serial("id").primaryKey(),
  jobId: integer("jobId").notNull(),
  tenantId: integer("tenantId").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (t) => ({
  tenantJobIdx: index("idx_studio_job_favorites_tenant_job").on(t.tenantId, t.jobId),
}));

export type JobFavorite = typeof jobFavorites.$inferSelect;
export type InsertJobFavorite = typeof jobFavorites.$inferInsert;

/** Per-tenant rollup of History dashboard aggregates. */
export const tenantStats = pgTable("studio_tenant_stats", {
  tenantId: integer("tenantId").primaryKey(),
  totalJobs: integer("totalJobs").default(0).notNull(),
  creditsSpent: integer("creditsSpent").default(0).notNull(),
  doneJobs: integer("doneJobs").default(0).notNull(),
  computedAt: timestamp("computedAt").defaultNow().notNull(),
});

export type TenantStats = typeof tenantStats.$inferSelect;
export type InsertTenantStats = typeof tenantStats.$inferInsert;

/** Server-side structured logs for production debugging. */
export const serverLogs = pgTable("server_logs", {
  id: serial("id").primaryKey(),
  level: logLevelEnum("level").default("info").notNull(),
  source: varchar("source", { length: 64 }).notNull(),
  message: varchar("message", { length: 1024 }).notNull(),
  metadata: jsonb("metadata"),
  jobId: integer("jobId"),
  tenantId: integer("tenantId"),
  userId: integer("userId"),
  durationMs: integer("durationMs"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (t) => ({
  tenantCreatedIdx: index("idx_server_logs_tenant_created").on(t.tenantId, t.createdAt),
  sourceIdx: index("idx_server_logs_source").on(t.source, t.createdAt),
  levelIdx: index("idx_server_logs_level").on(t.level, t.createdAt),
  jobIdx: index("idx_server_logs_job").on(t.jobId),
}));

export type ServerLog = typeof serverLogs.$inferSelect;
export type InsertServerLog = typeof serverLogs.$inferInsert;

/** Platform administrators — super_admin users who operate above all tenant accounts. */
export const platformAdmins = pgTable("platform_admins", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull().unique(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type PlatformAdmin = typeof platformAdmins.$inferSelect;
export type InsertPlatformAdmin = typeof platformAdmins.$inferInsert;

/** Invite Links — shareable tokens for self-service signup. */
export const inviteLinks = pgTable("invite_links", {
  id: serial("id").primaryKey(),
  token: varchar("token", { length: 64 }).notNull().unique(),
  type: inviteTypeEnum("type").notNull(),
  status: inviteStatusEnum("status").default("active").notNull(),
  tenantId: integer("tenantId"),
  metadata: jsonb("metadata"),
  maxUses: integer("maxUses"),
  useCount: integer("useCount").default(0).notNull(),
  expiresAt: timestamp("expiresAt"),
  createdBy: integer("createdBy").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  lastRedeemedAt: timestamp("lastRedeemedAt"),
});
export type InviteLink = typeof inviteLinks.$inferSelect;
export type InsertInviteLink = typeof inviteLinks.$inferInsert;

/** Invite link redemptions — tracks who redeemed each link. */
export const inviteLinkRedemptions = pgTable("invite_link_redemptions", {
  id: serial("id").primaryKey(),
  inviteLinkId: integer("inviteLinkId").notNull(),
  userId: integer("userId").notNull(),
  tenantId: integer("tenantId").notNull(),
  redeemedAt: timestamp("redeemedAt").defaultNow().notNull(),
});
export type InviteLinkRedemption = typeof inviteLinkRedemptions.$inferSelect;
export type InsertInviteLinkRedemption = typeof inviteLinkRedemptions.$inferInsert;
