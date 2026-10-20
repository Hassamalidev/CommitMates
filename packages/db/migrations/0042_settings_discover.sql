-- Discover's cold-start list (CLAUDE.md §8 F11 "UI").
insert into settings (key, value_type, default_value, min_sample, unit, description) values
  ('matching.coldStartListSize', 'integer', '10'::jsonb, 0, 'people', 'GitHub developers shown, view-only, on Discover before matching opens or before the first deck')
on conflict (key) do nothing;
