-- Every minute: resolve queued locations through the paced geocoder (CLAUDE.md §6.8, §8 F18).
-- The interval between geocoder calls is enforced by the geocoder_lock row, not by this schedule.
insert into job_schedules (name, cron_expr, job_type, next_run_at)
values ('geocode-pending', '* * * * *', 'geocode_pending', now())
on conflict (name) do nothing;
