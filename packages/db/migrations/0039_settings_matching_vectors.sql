-- Weekly skill vector refresh (CLAUDE.md §8 F11 "Vectors", §5.4 job catalog).
insert into settings (key, value_type, default_value, min_sample, unit, description) values
  ('matching.vectorRefreshDays', 'integer', '7'::jsonb, 0, 'days', 'Age at which a member''s skill vector is recomputed by the weekly refresh')
on conflict (key) do nothing;
--> statement-breakpoint
insert into job_schedules (name, cron_expr, job_type, next_run_at)
values ('refresh-skill-vectors', '0 3 * * 1', 'refresh_skill_vectors', now())
on conflict (name) do nothing;
