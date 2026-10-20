-- A partner's coded-today status on the streaks page (CLAUDE.md §8 F13 "UI").
insert into settings (key, value_type, default_value, min_sample, unit, description) values
  ('streaks.todayStatusCacheMinutes', 'integer', '30'::jsonb, 0, 'minutes', 'How long a partner''s coded-today status is reused before GitHub is asked again')
on conflict (key) do nothing;
