-- Hourly shared-streak judgement, batched by timezone through each day's readiness (CLAUDE.md §8 F13).
insert into job_schedules (name, cron_expr, job_type, next_run_at)
values ('streak-check', '15 * * * *', 'streak_check', now())
on conflict (name) do nothing;
