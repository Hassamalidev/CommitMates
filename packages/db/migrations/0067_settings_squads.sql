-- Squad Builder (CLAUDE.md §8 F21).
insert into settings (key, value_type, default_value, min_sample, unit, description) values
  ('squads.maxIterations', 'integer', '100'::jsonb, 0, 'iterations', 'Most k-means iterations per k when finding an event''s roles'),
  ('squads.maxTeamSize', 'integer', '12'::jsonb, 0, 'members', 'Largest team size an organizer can set for an event'),
  ('squads.titleMaxChars', 'integer', '120'::jsonb, 0, 'characters', 'Longest event title'),
  ('squads.descriptionMaxChars', 'integer', '2000'::jsonb, 0, 'characters', 'Longest event description'),
  ('squads.listLimit', 'integer', '50'::jsonb, 0, 'events', 'Events shown on the events page')
on conflict (key) do nothing;
