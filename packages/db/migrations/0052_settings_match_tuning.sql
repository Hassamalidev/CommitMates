-- Nightly match-weight tuning (CLAUDE.md §8 F11 "Weight tuning"), before the 02:30 decks.
insert into settings (key, value_type, default_value, min_sample, unit, description) values
  ('matching.successWindowDays', 'integer', '14'::jsonb, 0, 'days', 'Days after acceptance in which both sides must send matching.successMessages messages for a match to count as successful'),
  ('matching.tuneWindowDays', 'integer', '30'::jsonb, 0, 'days', 'Acted-on suggestions from this many days feed the nightly weight tuning')
on conflict (key) do nothing;
--> statement-breakpoint
insert into job_schedules (name, cron_expr, job_type, next_run_at)
values ('tune-match-weights', '0 2 * * *', 'tune_match_weights', now())
on conflict (name) do nothing;
