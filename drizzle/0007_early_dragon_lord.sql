CREATE TABLE `server_logs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`level` enum('debug','info','warn','error') NOT NULL DEFAULT 'info',
	`source` varchar(64) NOT NULL,
	`message` varchar(1024) NOT NULL,
	`metadata` json,
	`jobId` int,
	`tenantId` int,
	`userId` int,
	`durationMs` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `server_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_server_logs_tenant_created` ON `server_logs` (`tenantId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `idx_server_logs_source` ON `server_logs` (`source`,`createdAt`);--> statement-breakpoint
CREATE INDEX `idx_server_logs_level` ON `server_logs` (`level`,`createdAt`);--> statement-breakpoint
CREATE INDEX `idx_server_logs_job` ON `server_logs` (`jobId`);