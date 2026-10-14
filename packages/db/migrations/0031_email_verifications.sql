CREATE TABLE "email_verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"email" "citext",
	"domain" text NOT NULL,
	"university_id" uuid,
	"code_hash" text,
	"expires_at" timestamp with time zone,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"sends_today" smallint DEFAULT 0 NOT NULL,
	"last_sent_at" timestamp with time zone,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "email_verifications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "email_verifications" ADD CONSTRAINT "email_verifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_verifications" ADD CONSTRAINT "email_verifications_university_id_universities_id_fk" FOREIGN KEY ("university_id") REFERENCES "public"."universities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "email_verifications_pending_user_key" ON "email_verifications" USING btree ("user_id") WHERE "email_verifications"."verified_at" is null;--> statement-breakpoint
CREATE INDEX "email_verifications_user_idx" ON "email_verifications" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "email_verifications_university_idx" ON "email_verifications" USING btree ("university_id");--> statement-breakpoint
create trigger email_verifications_set_updated_at before update on email_verifications
  for each row execute function set_updated_at();
