-- M5d: FULLTEXT index for History search (title + detectedElements + instruction).
-- drizzle-orm 0.44 has no FULLTEXT API, so this is a hand-written custom migration
-- (the snapshot does not track it; drizzle-kit generate compares schema<->snapshot
-- and never emits a DROP for an index neither side knows about). The application
-- search (listTenantJobsEnhanced) probes for this index at runtime and uses
-- MATCH ... AGAINST when present, falling back to substring LIKE when absent —
-- so this migration is safe to apply before or after the code deploy.
ALTER TABLE `studio_jobs` ADD FULLTEXT INDEX `ft_studio_jobs_search` (`title`, `detectedElements`, `instruction`);
