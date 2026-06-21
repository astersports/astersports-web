CREATE TABLE `studio_tenant_stats` (
	`tenantId` int NOT NULL,
	`totalJobs` int NOT NULL DEFAULT 0,
	`creditsSpent` int NOT NULL DEFAULT 0,
	`doneJobs` int NOT NULL DEFAULT 0,
	`computedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `studio_tenant_stats_tenantId` PRIMARY KEY(`tenantId`)
);
