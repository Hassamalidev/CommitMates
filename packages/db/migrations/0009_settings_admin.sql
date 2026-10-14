-- Thresholds for the admin health page and its alerts (CLAUDE.md §5.13).
insert into settings (key, value_type, default_value, min_sample, unit, description) values
  ('admin.deadJobWindowHours', 'integer', '24'::jsonb, 0, 'hours', 'Window in which a dead job raises an alert'),
  ('admin.interactiveQueueAlertSeconds', 'integer', '120'::jsonb, 0, 'seconds', 'An interactive job queued longer than this raises an alert'),
  ('admin.budgetAlertPct', 'number', '0.9'::jsonb, 0, null, 'Share of a budget (database size, daily email) that raises an alert'),
  ('admin.sourceStaleDays', 'integer', '14'::jsonb, 0, 'days', 'A source snapshot older than this raises an alert'),
  ('admin.staleComputedDays', 'integer', '3'::jsonb, 0, 'days', 'A computed setting not refreshed for this long is listed as stale'),
  ('admin.jobListLimit', 'integer', '100'::jsonb, 0, null, 'Rows shown per job list on the admin pages')
on conflict (key) do nothing;
