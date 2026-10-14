CREATE TYPE "public"."university_request_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TABLE "university_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"domain" "citext" NOT NULL,
	"proposed_name" text NOT NULL,
	"country_code" char(2) NOT NULL,
	"status" "university_request_status" DEFAULT 'pending' NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"university_id" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "university_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "university_requests" ADD CONSTRAINT "university_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "university_requests" ADD CONSTRAINT "university_requests_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "university_requests" ADD CONSTRAINT "university_requests_university_id_universities_id_fk" FOREIGN KEY ("university_id") REFERENCES "public"."universities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "university_requests_pending_key" ON "university_requests" USING btree ("user_id","domain") WHERE "university_requests"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "university_requests_status_idx" ON "university_requests" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "university_requests_user_idx" ON "university_requests" USING btree ("user_id");--> statement-breakpoint
create trigger university_requests_set_updated_at before update on university_requests
  for each row execute function set_updated_at();
