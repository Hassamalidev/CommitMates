-- Daily maintenance (CLAUDE.md §5.10, §5.12): drop idle rate-limit buckets and rotate salts.
-- Salts rotate just after UTC midnight so the previous day's IP hashes become unlinkable promptly.
insert into job_schedules (name, cron_expr, job_type, next_run_at) values
  ('cleanup-rate-buckets', '15 3 * * *', 'cleanup_rate_buckets', now()),
  ('rotate-salts', '5 0 * * *', 'rotate_salts', now())
on conflict (name) do nothing;
