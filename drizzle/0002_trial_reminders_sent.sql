CREATE TABLE "trial_reminders_sent" (
	"tenantId" integer NOT NULL,
	"trialDay" integer NOT NULL,
	"sentAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "trial_reminders_sent_tenantId_trialDay_pk" PRIMARY KEY("tenantId","trialDay")
);
