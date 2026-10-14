-- Weekly: refresh universities (Hipo list) and the disposable email blocklist (CLAUDE.md §6.4, §6.5).
insert into job_schedules (name, cron_expr, job_type, next_run_at) values
  ('sync-hipo', '0 6 * * 0', 'sync_hipo', now()),
  ('sync-disposable-emails', '30 6 * * 0', 'sync_disposable_emails', now())
on conflict (name) do nothing;
