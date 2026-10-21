ALTER TABLE "gh_users" ADD COLUMN "index_country_code" char(2);--> statement-breakpoint
CREATE INDEX "gh_users_country_index_idx" ON "gh_users" USING btree ("index_country_code") WHERE "gh_users"."in_country_index";--> statement-breakpoint
-- Country crawler (CLAUDE.md §8 F18).
insert into settings (key, value_type, default_value, min_sample, unit, description) values
  ('crawler.pruneTargetPct', 'number', '0.95'::jsonb, 0, 'share', 'Share of crawler.maxUsers and crawler.maxRepos the storage guard prunes back to'),
  ('crawler.earliestAccountDate', 'string', '"2008-01-01"'::jsonb, 0, 'date', 'Earliest account creation date the crawl covers (GitHub launched in 2008)')
on conflict (key) do nothing;
--> statement-breakpoint
insert into job_schedules (name, cron_expr, job_type, next_run_at)
values ('crawl-country', '*/5 * * * *', 'crawl_country', now())
on conflict (name) do nothing;
