CREATE TABLE `categories` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(128) NOT NULL,
	`slug` varchar(128) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `categories_id` PRIMARY KEY(`id`),
	CONSTRAINT `categories_slug_unique` UNIQUE(`slug`)
);
--> statement-breakpoint
CREATE TABLE `credit_ledger` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tenantId` int NOT NULL,
	`userId` int,
	`delta` int NOT NULL,
	`balanceAfter` int NOT NULL,
	`reason` varchar(64) NOT NULL,
	`refId` varchar(128),
	`note` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `credit_ledger_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `studio_job_variations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`jobId` int NOT NULL,
	`tenantId` int NOT NULL,
	`resultKey` varchar(512) NOT NULL,
	`resultUrl` varchar(1024) NOT NULL,
	`round` int NOT NULL DEFAULT 1,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `studio_job_variations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `studio_jobs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tenantId` int NOT NULL,
	`userId` int NOT NULL,
	`title` varchar(255) NOT NULL,
	`originalKey` varchar(512) NOT NULL,
	`originalUrl` varchar(1024) NOT NULL,
	`detectedElements` text,
	`controls` text,
	`instruction` text,
	`status` enum('pending','processing','done','failed') NOT NULL DEFAULT 'pending',
	`creditsUsed` int DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `studio_jobs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `memberships` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tenantId` int NOT NULL,
	`userId` int NOT NULL,
	`role` enum('owner','admin','member') NOT NULL DEFAULT 'member',
	`status` enum('active','invited','disabled') NOT NULL DEFAULT 'active',
	`invitedEmail` varchar(320),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `memberships_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `tenants` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(255) NOT NULL,
	`slug` varchar(128) NOT NULL,
	`categoryId` int NOT NULL,
	`plan` enum('none','starter','pro','team') NOT NULL DEFAULT 'none',
	`creditBalance` int NOT NULL DEFAULT 0,
	`seats` int NOT NULL DEFAULT 1,
	`allowedEmailDomain` varchar(255),
	`stripeCustomerId` varchar(128),
	`stripeSubscriptionId` varchar(128),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `tenants_id` PRIMARY KEY(`id`),
	CONSTRAINT `tenants_slug_unique` UNIQUE(`slug`)
);
