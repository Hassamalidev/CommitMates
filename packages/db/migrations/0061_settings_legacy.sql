-- Senior's Legacy (CLAUDE.md §8 F17).
insert into settings (key, value_type, default_value, min_sample, unit, description) values
  ('legacy.blurbMaxChars', 'integer', '280'::jsonb, 0, 'characters', 'Longest blurb a member can add to a showcase entry'),
  ('legacy.excerptChars', 'integer', '600'::jsonb, 0, 'characters', 'README characters shown, as plain text, on an entry''s detail view'),
  ('legacy.listLimit', 'integer', '50'::jsonb, 0, 'entries', 'Entries shown per search on Senior''s Legacy')
on conflict (key) do nothing;
--> statement-breakpoint
insert into job_schedules (name, cron_expr, job_type, next_run_at)
values ('legacy-refresh', '0 6 * * 3', 'legacy_refresh', now())
on conflict (name) do nothing;
