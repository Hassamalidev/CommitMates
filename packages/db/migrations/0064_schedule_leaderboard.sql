-- Weekly leaderboards (CLAUDE.md §8 F19): Monday 00:00 UTC, for the week that just ended.
insert into job_schedules (name, cron_expr, job_type, next_run_at)
values ('leaderboard-weekly', '0 0 * * 1', 'leaderboard_weekly', now())
on conflict (name) do nothing;
