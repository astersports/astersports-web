ALTER TABLE `tenants` ADD `trialStartedAt` timestamp;--> statement-breakpoint
ALTER TABLE `tenants` ADD `trialCredits` int DEFAULT 0 NOT NULL;