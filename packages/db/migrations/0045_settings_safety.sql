-- Length caps for reports and feedback (CLAUDE.md §8 F12 "Reports and auto-hide").
insert into settings (key, value_type, default_value, min_sample, unit, description) values
  ('safety.reportDetailsMaxChars', 'integer', '1000'::jsonb, 0, 'characters', 'Longest optional details text on a report'),
  ('feedback.maxChars', 'integer', '2000'::jsonb, 0, 'characters', 'Longest feedback or appeal text')
on conflict (key) do nothing;
