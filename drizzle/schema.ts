import { int, mysqlEnum, mysqlTable, text, timestamp, varchar, boolean, json } from "drizzle-orm/mysql-core";

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
