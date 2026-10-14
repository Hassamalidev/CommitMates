-- Hourly purge of expired raw data about people who are not members (CLAUDE.md §5.12).
insert into job_schedules (name, cron_expr, job_type, next_run_at)
values ('purge-non-user-raw', '10 * * * *', 'purge_non_user_raw', now())
on conflict (name) do nothing;
