-- REST call cap per GitHub token (ADR-014): parallel reads stay under GitHub's secondary limit.
insert into settings (key, value_type, default_value, min_sample, unit, description) values
  ('github.requestsPerMinute', 'integer', '800'::jsonb, 0, 'requests', 'REST calls one GitHub token may make per minute, below GitHub''s secondary limit of 900 points')
on conflict (key) do nothing;
