CREATE INDEX `idx_credit_ledger_tenant_created` ON `credit_ledger` (`tenantId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `idx_credit_ledger_refId` ON `credit_ledger` (`refId`);--> statement-breakpoint
CREATE INDEX `idx_studio_job_favorites_tenant_job` ON `studio_job_favorites` (`tenantId`,`jobId`);--> statement-breakpoint
CREATE INDEX `idx_studio_job_variations_jobId` ON `studio_job_variations` (`jobId`);--> statement-breakpoint
CREATE INDEX `idx_studio_jobs_tenant_created` ON `studio_jobs` (`tenantId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `idx_memberships_tenant_user` ON `memberships` (`tenantId`,`userId`);