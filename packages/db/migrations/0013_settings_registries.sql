-- Timeout for registry calls (CLAUDE.md §6.6).
insert into settings (key, value_type, default_value, min_sample, unit, description) values
  ('sources.requestTimeoutMs', 'integer', '15000'::jsonb, 0, 'ms', 'Per-request timeout for package registries and other non-GitHub sources')
on conflict (key) do nothing;
