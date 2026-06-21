CREATE TABLE `invite_link_redemptions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`inviteLinkId` int NOT NULL,
	`userId` int NOT NULL,
	`tenantId` int NOT NULL,
	`redeemedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `invite_link_redemptions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `invite_links` (
	`id` int AUTO_INCREMENT NOT NULL,
	`token` varchar(64) NOT NULL,
	`type` enum('firm','individual','join') NOT NULL,
	`status` enum('active','redeemed','expired','revoked') NOT NULL DEFAULT 'active',
	`tenantId` int,
	`metadata` json,
	`maxUses` int,
	`useCount` int NOT NULL DEFAULT 0,
	`expiresAt` timestamp,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`lastRedeemedAt` timestamp,
	CONSTRAINT `invite_links_id` PRIMARY KEY(`id`),
	CONSTRAINT `invite_links_token_unique` UNIQUE(`token`)
);
