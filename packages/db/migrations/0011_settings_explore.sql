-- Batch size of the github/explore topic sync (CLAUDE.md §6.2).
insert into settings (key, value_type, default_value, min_sample, unit, description) values
  ('sources.explore.batchSize', 'integer', '200'::jsonb, 0, null, 'Topic files fetched per sync run; the rest continue in the next run')
on conflict (key) do nothing;
--> statement-breakpoint
-- Weekly refresh, Sundays 04:30 UTC, after Linguist. Runs on the first tick after deploy.
insert into job_schedules (name, cron_expr, job_type, next_run_at)
values ('sync-explore', '30 4 * * 0', 'sync_explore', now())
on conflict (name) do nothing;
