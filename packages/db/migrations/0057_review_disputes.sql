ALTER TABLE "review_requests" ADD COLUMN "disputed_by" uuid;--> statement-breakpoint
ALTER TABLE "review_requests" ADD COLUMN "dispute_note" text;--> statement-breakpoint
ALTER TABLE "review_requests" ADD COLUMN "disputed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "review_requests" ADD CONSTRAINT "review_requests_disputed_by_users_id_fk" FOREIGN KEY ("disputed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "review_requests_disputed_by_idx" ON "review_requests" USING btree ("disputed_by");--> statement-breakpoint
-- Review verification, settlement and disputes (CLAUDE.md §8 F15).
insert into settings (key, value_type, default_value, min_sample, unit, description) values
  ('reviews.verifyRetryMinutes', 'integer', '60'::jsonb, 0, 'minutes', 'Wait between checks for a submitted review that GitHub does not show yet'),
  ('reviews.disputeWindowDays', 'integer', '7'::jsonb, 0, 'days', 'Days after an unhelpful rating in which the reviewer can dispute it'),
  ('reviews.disputeNoteMaxChars', 'integer', '500'::jsonb, 0, 'characters', 'Longest note a reviewer can add to a dispute'),
  ('reviews.reputationTierCuts', 'number[]', '[0.5, 0.75, 0.9]'::jsonb, 0, 'percentile', 'Percentiles of helpful reviews within the university that reach each reputation tier')
on conflict (key) do nothing;
--> statement-breakpoint
insert into job_schedules (name, cron_expr, job_type, next_run_at)
values ('expire-reviews', '15 * * * *', 'expire_reviews', now())
on conflict (name) do nothing;
