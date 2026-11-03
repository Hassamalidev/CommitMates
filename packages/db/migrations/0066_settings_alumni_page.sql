-- Alumni Quick Asks page (CLAUDE.md §8 F20).
insert into settings (key, value_type, default_value, min_sample, unit, description) values
  ('alumni.listLimit', 'integer', '50'::jsonb, 0, 'questions', 'Questions shown per list on the Alumni Quick Asks page')
on conflict (key) do nothing;
