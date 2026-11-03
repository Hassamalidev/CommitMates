-- FYP Board (CLAUDE.md §8 F22).
insert into settings (key, value_type, default_value, min_sample, unit, description) values
  ('fyp.interestMaxChars', 'integer', '500'::jsonb, 0, 'characters', 'Longest message a member can send with their interest in an idea'),
  ('fyp.maxSupervisorAreas', 'integer', '10'::jsonb, 0, 'tags', 'Areas a supervisor can list'),
  ('fyp.listLimit', 'integer', '50'::jsonb, 0, 'items', 'Ideas, supervisors or past projects shown per list on the FYP Board')
on conflict (key) do nothing;
