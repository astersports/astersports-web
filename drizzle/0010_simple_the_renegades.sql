ALTER TABLE `studio_jobs` ADD `errorMessage` text;--> statement-breakpoint
ALTER TABLE `credit_ledger` ADD CONSTRAINT `uniq_credit_ledger_ref_reason` UNIQUE(`refId`,`reason`);