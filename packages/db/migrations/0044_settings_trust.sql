-- Trust score inputs named in CLAUDE.md §8 F12 "Trust score", and its nightly schedule.
insert into settings (key, value_type, default_value, min_sample, unit, description) values
  ('trust.ageFullDays', 'integer', '30'::jsonb, 0, 'days', 'Account age at which the age component of trust reaches 1'),
  ('trust.acceptRateWindowDays', 'integer', '30'::jsonb, 0, 'days', 'Window over which accepted ÷ sent message requests is measured'),
  ('trust.acceptRateMinSent', 'integer', '3'::jsonb, 0, 'requests', 'Requests a member must have sent before their accept rate counts; fewer use the prior'),
  ('trust.acceptRatePrior', 'number', '0.5'::jsonb, 0, 'share', 'Accept rate assumed for members who sent too few requests to measure'),
  ('trust.reportCap', 'integer', '3'::jsonb, 0, 'reporters', 'Distinct verified reporters at which the reports component of trust is full')
on conflict (key) do nothing;
--> statement-breakpoint
insert into job_schedules (name, cron_expr, job_type, next_run_at)
values ('compute-trust', '0 2 * * *', 'compute_trust', now())
on conflict (name) do nothing;
