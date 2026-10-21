-- Gap Finder campus layer (CLAUDE.md §8 F5 step 7).
insert into settings (key, value_type, default_value, min_sample, unit, description) values
  ('gap.helpersPerGap', 'integer', '3'::jsonb, 0, 'members', 'Members of the university shown as able to help with one gap')
on conflict (key) do nothing;
