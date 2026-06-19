CREATE TABLE `studio_job_favorites` (
	`id` int AUTO_INCREMENT NOT NULL,
	`jobId` int NOT NULL,
	`tenantId` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `studio_job_favorites_id` PRIMARY KEY(`id`)
);
