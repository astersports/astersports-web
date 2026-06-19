import { int, mysqlEnum, mysqlTable, text, timestamp, varchar, boolean, json, bigint } from "drizzle-orm/mysql-core";

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
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
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
  plan: mysqlEnum("plan", ["none", "starter", "pro", "team"]).default("none").notNull(),
  creditBalance: int("creditBalance").default(0).notNull(),
  seats: int("seats").default(1).notNull(),
  /** Restrict membership to emails from this domain (null = open). */
  allowedEmailDomain: varchar("allowedEmailDomain", { length: 255 }),
  /** Stripe Customer ID for this tenant. */
  stripeCustomerId: varchar("stripeCustomerId", { length: 128 }),
  /** Stripe Subscription ID for the active plan. */
  stripeSubscriptionId: varchar("stripeSubscriptionId", { length: 128 }),
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
});

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
});

export type CreditLedgerEntry = typeof creditLedger.$inferSelect;
export type InsertCreditLedgerEntry = typeof creditLedger.$inferInsert;

/**
 * Studio jobs — each upload/edit session.
 */
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
  /** Natural-language instruction sent to AI. */
  instruction: text("instruction"),
  status: mysqlEnum("status", ["pending", "processing", "done", "failed"]).default("pending").notNull(),
  creditsUsed: int("creditsUsed").default(0),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

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
});

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
