CREATE TABLE "generic_message_counts" (
	"message" text PRIMARY KEY NOT NULL,
	"count" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "generic_message_counts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "recruiter_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"subject_github_id" bigint NOT NULL,
	"score" smallint,
	"rules" jsonb NOT NULL,
	"secret_findings" jsonb NOT NULL,
	"secret_scan_partial" boolean DEFAULT false NOT NULL,
	"files_scanned" integer DEFAULT 0 NOT NULL,
	"computed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "recruiter_reports" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "recruiter_reports" ADD CONSTRAINT "recruiter_reports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "generic_message_counts_count_idx" ON "generic_message_counts" USING btree ("count");--> statement-breakpoint
CREATE INDEX "recruiter_reports_user_computed_idx" ON "recruiter_reports" USING btree ("user_id","computed_at");--> statement-breakpoint
create trigger generic_message_counts_set_updated_at before update on generic_message_counts
  for each row execute function set_updated_at();
