-- Which READMEs count toward the computed README length target (CLAUDE.md §5.5.1 recruiter.readme.minChars).
insert into settings (key, value_type, default_value, min_sample, unit, description) values
  ('recruiter.readme.sampleMinStars', 'integer', '10'::jsonb, 0, 'stars', 'Stars a repository needs before its README length counts toward recruiter.readme.minChars')
on conflict (key) do nothing;
