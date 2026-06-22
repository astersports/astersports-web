ALTER TABLE `studio_jobs` MODIFY COLUMN `status` enum('pending','processing','done','failed','sam2_processing','cpu_processing') NOT NULL DEFAULT 'pending';--> statement-breakpoint
ALTER TABLE `studio_jobs` ADD `predictionId` varchar(255);--> statement-breakpoint
ALTER TABLE `studio_jobs` ADD `enqueuedAt` timestamp;