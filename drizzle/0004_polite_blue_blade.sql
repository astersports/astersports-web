CREATE TABLE "tenant_domains" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenantId" integer NOT NULL,
	"domain" varchar(255) NOT NULL,
	"verifiedAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_tenant_domains_tenant_domain" ON "tenant_domains" USING btree ("tenantId","domain");--> statement-breakpoint
CREATE INDEX "idx_tenant_domains_tenant" ON "tenant_domains" USING btree ("tenantId");