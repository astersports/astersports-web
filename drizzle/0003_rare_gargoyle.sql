CREATE TABLE "platform_audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"actorUserId" integer NOT NULL,
	"action" varchar(64) NOT NULL,
	"targetTenantId" integer,
	"targetUserId" integer,
	"summary" varchar(512) NOT NULL,
	"metadata" jsonb,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_platform_audit_target_tenant_created" ON "platform_audit_log" USING btree ("targetTenantId","createdAt");--> statement-breakpoint
CREATE INDEX "idx_platform_audit_actor_created" ON "platform_audit_log" USING btree ("actorUserId","createdAt");--> statement-breakpoint
CREATE INDEX "idx_platform_audit_action_created" ON "platform_audit_log" USING btree ("action","createdAt");