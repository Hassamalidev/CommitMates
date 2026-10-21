-- Review Exchange requests (CLAUDE.md §8 F15 "Request", "Claim and verify").
insert into settings (key, value_type, default_value, min_sample, unit, description) values
  ('reviews.maxLanguages', 'integer', '5'::jsonb, 0, 'languages', 'Languages of changed files kept on a review request, most files first'),
  ('reviews.listLimit', 'integer', '50'::jsonb, 0, 'requests', 'Review requests shown per list on the Review Exchange')
on conflict (key) do nothing;
