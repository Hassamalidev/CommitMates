-- Notification center and daily digests (CLAUDE.md §7.5, §5.4 digest_email).
insert into settings (key, value_type, default_value, min_sample, unit, description) values
  ('email.digestMaxItems', 'integer', '20'::jsonb, 0, 'notifications', 'Most notifications listed in one daily digest email; the rest wait for the next one'),
  ('notifications.listLimit', 'integer', '50'::jsonb, 0, 'notifications', 'Notifications shown in the notification center')
on conflict (key) do nothing;
--> statement-breakpoint
insert into job_schedules (name, cron_expr, job_type, next_run_at)
values ('digest-dispatch', '0 * * * *', 'digest_email', now())
on conflict (name) do nothing;
