ALTER TABLE `tenants` ADD `stripeSetupIntentId` varchar(128);--> statement-breakpoint
ALTER TABLE `tenants` ADD `stripePaymentMethodId` varchar(128);--> statement-breakpoint
ALTER TABLE `tenants` ADD `trialConvertedAt` timestamp;--> statement-breakpoint
ALTER TABLE `tenants` ADD `trialFrozenCredits` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `tenants` ADD `trialFrozenAt` timestamp;