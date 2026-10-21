-- Uni listings (CLAUDE.md §8 F14): private suggestions and the owner's note.
insert into settings (key, value_type, default_value, min_sample, unit, description) values
  ('adoptions.suggestMinUnfinished', 'number', '0.5'::jsonb, 0, 'score', 'Unfinished score at which a member''s own inactive repository is suggested for listing'),
  ('adoptions.noteMaxChars', 'integer', '280'::jsonb, 0, 'characters', 'Longest note an owner can add to a listing')
on conflict (key) do nothing;
--> statement-breakpoint
insert into job_schedules (name, cron_expr, job_type, next_run_at)
values ('suggest-listings', '0 4 * * 1', 'suggest_listings', now())
on conflict (name) do nothing;
