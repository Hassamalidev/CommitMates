-- Moderation queue limits (CLAUDE.md §8 F12 "Moderation queue") and the hourly end of suspensions.
insert into settings (key, value_type, default_value, min_sample, unit, description) values
  ('safety.contextMessages', 'integer', '10'::jsonb, 0, 'messages', 'Messages around a reported message shown to the moderator handling the report'),
  ('safety.maxSuspensionDays', 'integer', '365'::jsonb, 0, 'days', 'Longest suspension a moderator can set; longer means a ban')
on conflict (key) do nothing;
--> statement-breakpoint
insert into job_schedules (name, cron_expr, job_type, next_run_at)
values ('lift-suspensions', '5 * * * *', 'lift_suspensions', now())
on conflict (name) do nothing;
