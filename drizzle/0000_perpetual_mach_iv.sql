CREATE TABLE `games` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tournamentId` varchar(64) NOT NULL,
	`externalId` varchar(128) NOT NULL,
	`homeTeam` varchar(255) NOT NULL,
	`awayTeam` varchar(255) NOT NULL,
	`homeScore` int,
	`awayScore` int,
	`isLegacyHome` boolean NOT NULL DEFAULT true,
	`scheduledTime` varchar(64),
	`status` varchar(32) DEFAULT 'Scheduled',
	`court` varchar(128),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `games_id` PRIMARY KEY(`id`),
	CONSTRAINT `games_externalId_unique` UNIQUE(`externalId`)
);
--> statement-breakpoint
CREATE TABLE `scraper_cache` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tournamentId` varchar(64) NOT NULL,
	`lastScrapedAt` timestamp NOT NULL DEFAULT (now()),
	`cachedData` json,
	`gameCount` int DEFAULT 0,
	CONSTRAINT `scraper_cache_id` PRIMARY KEY(`id`),
	CONSTRAINT `scraper_cache_tournamentId_unique` UNIQUE(`tournamentId`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` int AUTO_INCREMENT NOT NULL,
	`openId` varchar(64) NOT NULL,
	`name` text,
	`email` varchar(320),
	`loginMethod` varchar(64),
	`role` enum('user','admin') NOT NULL DEFAULT 'user',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`lastSignedIn` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_openId_unique` UNIQUE(`openId`)
);
