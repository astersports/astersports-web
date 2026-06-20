CREATE TABLE `platform_admins` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `platform_admins_id` PRIMARY KEY(`id`),
	CONSTRAINT `platform_admins_userId_unique` UNIQUE(`userId`)
);
--> statement-breakpoint
ALTER TABLE `tenants` ADD `type` enum('firm','individual') DEFAULT 'firm' NOT NULL;