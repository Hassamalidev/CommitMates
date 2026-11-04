-- Search headroom for visitors (ADR-014): the country crawler shares the server token and could
-- spend a minute's whole search allowance, leaving day-one tools waiting for the window to reset.
insert into settings (key, value_type, default_value, min_sample, unit, description) values
  ('github.reserve.searchBackground', 'integer', '10'::jsonb, 0, 'searches', 'Searches per minute background work (crawler, weekly refreshes) leaves for tools people are waiting on')
on conflict (key) do nothing;
