ALTER TABLE "fyp_projects" ADD COLUMN "corpus_text" text;--> statement-breakpoint
ALTER TABLE "fyp_projects" ADD COLUMN "dismissed_at" timestamp with time zone;--> statement-breakpoint
-- Weekly detection of members' final-year projects (CLAUDE.md §8 F22 "Past projects corpus").
insert into job_schedules (name, cron_expr, job_type, next_run_at)
values ('fyp-detect-projects', '0 6 * * 3', 'fyp_detect_projects', now())
on conflict (name) do nothing;
