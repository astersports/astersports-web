-- Custom SQL migration file, put your code below! --

-- Postgres has no column-level `ON UPDATE CURRENT_TIMESTAMP` (the MySQL
-- onUpdateNow() that maintained every `updatedAt`). Replace it with a BEFORE
-- UPDATE trigger that stamps `updatedAt = now()` on every row update — faithful
-- to the old semantics (the app never set `updatedAt` itself; it relied on the
-- engine). LOAD-BEARING: recoverStrandedCpuJobs (T1.5) ages stranded
-- cpu_processing jobs off `studio_jobs.updatedAt`, so the claim write MUST bump
-- it or a strand could never be detected.

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW."updatedAt" = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER trg_set_updated_at_billing_clients
  BEFORE UPDATE ON "billing_clients"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER trg_set_updated_at_games
  BEFORE UPDATE ON "games"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER trg_set_updated_at_studio_jobs
  BEFORE UPDATE ON "studio_jobs"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER trg_set_updated_at_tenants
  BEFORE UPDATE ON "tenants"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER trg_set_updated_at_users
  BEFORE UPDATE ON "users"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
