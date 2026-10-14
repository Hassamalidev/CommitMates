CREATE TABLE "fairness_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repo_github_id" bigint NOT NULL,
	"params" jsonb NOT NULL,
	"result" jsonb NOT NULL,
	"computed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fairness_reports" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "fairness_reports_computed_idx" ON "fairness_reports" USING btree ("computed_at");