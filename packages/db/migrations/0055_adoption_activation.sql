ALTER TABLE "adoptions" ADD COLUMN "activated_at" timestamp with time zone;--> statement-breakpoint
-- Adoptions started before this column existed were activated when last updated.
update adoptions set activated_at = updated_at where status in ('active', 'revived') and activated_at is null;
--> statement-breakpoint
-- Revival tracking (CLAUDE.md §8 F14 "Revival tracking"): daily.
insert into job_schedules (name, cron_expr, job_type, next_run_at)
values ('track-revivals', '0 5 * * *', 'track_revivals', now())
on conflict (name) do nothing;
