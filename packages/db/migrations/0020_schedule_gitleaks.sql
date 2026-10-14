-- Weekly: refresh gitleaks' default secret-detection rules (CLAUDE.md §6.7).
insert into job_schedules (name, cron_expr, job_type, next_run_at)
values ('sync-gitleaks', '45 4 * * 0', 'sync_gitleaks', now())
on conflict (name) do nothing;
