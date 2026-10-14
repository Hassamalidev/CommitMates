-- Onboarding details limits (CLAUDE.md §8 F10 step 7).
insert into settings (key, value_type, default_value, min_sample, unit, description) values
  ('profile.maxLearningGoals', 'integer', '10'::jsonb, 0, 'tags', 'Learning goals a member can pick'),
  ('profile.gradYearMaxAhead', 'integer', '8'::jsonb, 0, 'years', 'How far in the future a graduation year may be'),
  ('profile.gradYearMaxBehind', 'integer', '60'::jsonb, 0, 'years', 'How far in the past a graduation year may be')
on conflict (key) do nothing;
