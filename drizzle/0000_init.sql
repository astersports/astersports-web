CREATE TYPE "public"."invite_status" AS ENUM('active', 'redeemed', 'expired', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."invite_type" AS ENUM('firm', 'individual', 'join');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('pending', 'processing', 'done', 'failed', 'sam2_processing', 'cpu_processing');--> statement-breakpoint
CREATE TYPE "public"."log_level" AS ENUM('debug', 'info', 'warn', 'error');--> statement-breakpoint
CREATE TYPE "public"."membership_role" AS ENUM('owner', 'admin', 'member');--> statement-breakpoint
CREATE TYPE "public"."membership_status" AS ENUM('active', 'invited', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."tenant_plan" AS ENUM('none', 'starter', 'pro', 'team');--> statement-breakpoint
CREATE TYPE "public"."tenant_type" AS ENUM('firm', 'individual');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('user', 'admin');--> statement-breakpoint
CREATE TABLE "billing_clients" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"email" varchar(320) NOT NULL,
	"stripeCustomerId" varchar(128) NOT NULL,
	"stripeSubscriptionId" varchar(128),
	"subscriptionStatus" varchar(32) DEFAULT 'none',
	"notes" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "billing_clients_stripeCustomerId_unique" UNIQUE("stripeCustomerId")
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(128) NOT NULL,
	"slug" varchar(128) NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "categories_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "credit_ledger" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenantId" integer NOT NULL,
	"userId" integer,
	"delta" integer NOT NULL,
	"balanceAfter" integer NOT NULL,
	"reason" varchar(64) NOT NULL,
	"refId" varchar(128),
	"note" text,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "games" (
	"id" serial PRIMARY KEY NOT NULL,
	"tournamentId" varchar(64) NOT NULL,
	"externalId" varchar(128) NOT NULL,
	"homeTeam" varchar(255) NOT NULL,
	"awayTeam" varchar(255) NOT NULL,
	"homeScore" integer,
	"awayScore" integer,
	"isLegacyHome" boolean DEFAULT true NOT NULL,
	"scheduledTime" varchar(64),
	"status" varchar(32) DEFAULT 'Scheduled',
	"court" varchar(128),
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "games_externalId_unique" UNIQUE("externalId")
);
--> statement-breakpoint
CREATE TABLE "invite_link_redemptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"inviteLinkId" integer NOT NULL,
	"userId" integer NOT NULL,
	"tenantId" integer NOT NULL,
	"redeemedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invite_links" (
	"id" serial PRIMARY KEY NOT NULL,
	"token" varchar(64) NOT NULL,
	"type" "invite_type" NOT NULL,
	"status" "invite_status" DEFAULT 'active' NOT NULL,
	"tenantId" integer,
	"metadata" jsonb,
	"maxUses" integer,
	"useCount" integer DEFAULT 0 NOT NULL,
	"expiresAt" timestamp,
	"createdBy" integer NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"lastRedeemedAt" timestamp,
	CONSTRAINT "invite_links_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "studio_job_favorites" (
	"id" serial PRIMARY KEY NOT NULL,
	"jobId" integer NOT NULL,
	"tenantId" integer NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "studio_job_variations" (
	"id" serial PRIMARY KEY NOT NULL,
	"jobId" integer NOT NULL,
	"tenantId" integer NOT NULL,
	"resultKey" varchar(512) NOT NULL,
	"resultUrl" varchar(1024) NOT NULL,
	"round" integer DEFAULT 1 NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "studio_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenantId" integer NOT NULL,
	"userId" integer NOT NULL,
	"title" varchar(255) NOT NULL,
	"originalKey" varchar(512) NOT NULL,
	"originalUrl" varchar(1024) NOT NULL,
	"detectedElements" text,
	"controls" text,
	"editType" varchar(16),
	"instruction" text,
	"status" "job_status" DEFAULT 'pending' NOT NULL,
	"creditsUsed" integer DEFAULT 0,
	"errorMessage" text,
	"predictionId" varchar(255),
	"enqueuedAt" timestamp,
	"predictionMeta" jsonb,
	"pollAttempts" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenantId" integer NOT NULL,
	"userId" integer NOT NULL,
	"role" "membership_role" DEFAULT 'member' NOT NULL,
	"status" "membership_status" DEFAULT 'active' NOT NULL,
	"invitedEmail" varchar(320),
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_admins" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "platform_admins_userId_unique" UNIQUE("userId")
);
--> statement-breakpoint
CREATE TABLE "scraper_cache" (
	"id" serial PRIMARY KEY NOT NULL,
	"tournamentId" varchar(64) NOT NULL,
	"lastScrapedAt" timestamp DEFAULT now() NOT NULL,
	"cachedData" jsonb,
	"gameCount" integer DEFAULT 0,
	CONSTRAINT "scraper_cache_tournamentId_unique" UNIQUE("tournamentId")
);
--> statement-breakpoint
CREATE TABLE "server_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"level" "log_level" DEFAULT 'info' NOT NULL,
	"source" varchar(64) NOT NULL,
	"message" varchar(1024) NOT NULL,
	"metadata" jsonb,
	"jobId" integer,
	"tenantId" integer,
	"userId" integer,
	"durationMs" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stripe_events" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"type" varchar(128) NOT NULL,
	"processedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "studio_tenant_stats" (
	"tenantId" integer PRIMARY KEY NOT NULL,
	"totalJobs" integer DEFAULT 0 NOT NULL,
	"creditsSpent" integer DEFAULT 0 NOT NULL,
	"doneJobs" integer DEFAULT 0 NOT NULL,
	"computedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"slug" varchar(128) NOT NULL,
	"categoryId" integer NOT NULL,
	"type" "tenant_type" DEFAULT 'firm' NOT NULL,
	"plan" "tenant_plan" DEFAULT 'none' NOT NULL,
	"creditBalance" integer DEFAULT 0 NOT NULL,
	"seats" integer DEFAULT 1 NOT NULL,
	"allowedEmailDomain" varchar(255),
	"trialStartedAt" timestamp,
	"trialCredits" integer DEFAULT 0 NOT NULL,
	"stripeCustomerId" varchar(128),
	"stripeSubscriptionId" varchar(128),
	"stripeSetupIntentId" varchar(128),
	"stripePaymentMethodId" varchar(128),
	"trialConvertedAt" timestamp,
	"trialFrozenCredits" integer DEFAULT 0 NOT NULL,
	"trialFrozenAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "tenants_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"openId" varchar(64) NOT NULL,
	"name" text,
	"email" varchar(320),
	"passwordHash" varchar(255),
	"loginMethod" varchar(64),
	"role" "user_role" DEFAULT 'user' NOT NULL,
	"subscriptionType" varchar(64),
	"organizationId" integer,
	"isActive" boolean DEFAULT true NOT NULL,
	"emailVerified" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	"lastSignedIn" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_openId_unique" UNIQUE("openId")
);
--> statement-breakpoint
CREATE INDEX "idx_credit_ledger_tenant_created" ON "credit_ledger" USING btree ("tenantId","createdAt");--> statement-breakpoint
CREATE INDEX "idx_credit_ledger_tenant_user_delta" ON "credit_ledger" USING btree ("tenantId","userId","delta");--> statement-breakpoint
CREATE INDEX "idx_credit_ledger_refId" ON "credit_ledger" USING btree ("refId");--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_credit_ledger_ref_reason" ON "credit_ledger" USING btree ("refId","reason");--> statement-breakpoint
CREATE INDEX "idx_studio_job_favorites_tenant_job" ON "studio_job_favorites" USING btree ("tenantId","jobId");--> statement-breakpoint
CREATE INDEX "idx_studio_job_variations_jobId" ON "studio_job_variations" USING btree ("jobId");--> statement-breakpoint
CREATE INDEX "idx_studio_jobs_tenant_created" ON "studio_jobs" USING btree ("tenantId","createdAt");--> statement-breakpoint
CREATE INDEX "idx_memberships_tenant_user" ON "memberships" USING btree ("tenantId","userId");--> statement-breakpoint
CREATE INDEX "idx_server_logs_tenant_created" ON "server_logs" USING btree ("tenantId","createdAt");--> statement-breakpoint
CREATE INDEX "idx_server_logs_source" ON "server_logs" USING btree ("source","createdAt");--> statement-breakpoint
CREATE INDEX "idx_server_logs_level" ON "server_logs" USING btree ("level","createdAt");--> statement-breakpoint
CREATE INDEX "idx_server_logs_job" ON "server_logs" USING btree ("jobId");