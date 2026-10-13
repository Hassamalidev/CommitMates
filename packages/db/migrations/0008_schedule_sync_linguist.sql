-- Weekly refresh of GitHub Linguist data (CLAUDE.md §6.3). Runs on the first tick after deploy, then Sundays 04:00 UTC.
insert into job_schedules (name, cron_expr, job_type, next_run_at)
values ('sync-linguist', '0 4 * * 0', 'sync_linguist', now())
on conflict (name) do nothing;
