-- Faster day-one tools (ADR-014): parallel GitHub reads and fewer topic-count searches per expansion.
insert into settings (key, value_type, default_value, min_sample, unit, description) values
  ('github.concurrency', 'integer', '6'::jsonb, 0, 'requests', 'GitHub requests one job may have in flight at once; GitHub allows 100 per token'),
  ('taxonomy.maxCountLookups', 'integer', '8'::jsonb, 0, 'searches', 'Topics whose GitHub-wide count one expansion may look up; the rest are counted by later expansions')
on conflict (key) do nothing;
