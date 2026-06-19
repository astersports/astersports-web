CREATE TABLE `stripe_events` (
	`id` varchar(255) NOT NULL,
	`type` varchar(128) NOT NULL,
	`processedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `stripe_events_id` PRIMARY KEY(`id`)
);
