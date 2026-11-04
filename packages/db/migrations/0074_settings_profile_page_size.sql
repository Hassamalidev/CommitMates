-- Repositories per profile page (ADR-014): a large account's 100 repositories with its contribution
-- calendar ran past GitHub's time limit and failed with 502, so the calendar is read separately and
-- repositories in pages of this size.
insert into settings (key, value_type, default_value, min_sample, unit, description) values
  ('github.profilePageSize', 'integer', '50'::jsonb, 0, 'repositories', 'Repositories read per GraphQL page of a profile; GitHub allows 100, but large pages can exceed its time limit')
on conflict (key) do nothing;
