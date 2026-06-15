CREATE TABLE `billing_clients` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(255) NOT NULL,
	`email` varchar(320) NOT NULL,
	`stripeCustomerId` varchar(128) NOT NULL,
	`stripeSubscriptionId` varchar(128),
	`subscriptionStatus` varchar(32) DEFAULT 'none',
	`notes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `billing_clients_id` PRIMARY KEY(`id`),
	CONSTRAINT `billing_clients_stripeCustomerId_unique` UNIQUE(`stripeCustomerId`)
);
