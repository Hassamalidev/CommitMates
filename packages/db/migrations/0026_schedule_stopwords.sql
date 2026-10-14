-- Weekly: refresh the stopword lists from stopwords-iso (CLAUDE.md §8 F9 step 1).
insert into job_schedules (name, cron_expr, job_type, next_run_at)
values ('sync-stopwords', '0 5 * * 0', 'sync_stopwords', now())
on conflict (name) do nothing;
