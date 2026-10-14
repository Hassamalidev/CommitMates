-- Nightly recompute of data-driven settings (CLAUDE.md §5.5). 02:30 UTC keeps it clear of other nightly jobs.
insert into job_schedules (name, cron_expr, job_type, next_run_at)
values ('recompute-settings', '30 2 * * *', 'recompute_settings', now())
on conflict (name) do nothing;
