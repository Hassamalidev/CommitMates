-- Open-Source Starter campus layer (CLAUDE.md §8 F8 step 5).
insert into settings (key, value_type, default_value, min_sample, unit, description) values
  ('oss.memberContribPages', 'integer', '1'::jsonb, 0, 'pages', 'Pages of 100 merged pull requests read per member each week'),
  ('oss.campusContributorsPerRepo', 'integer', '3'::jsonb, 0, 'members', 'Members of the university shown as having contributed to one project')
on conflict (key) do nothing;
--> statement-breakpoint
insert into job_schedules (name, cron_expr, job_type, next_run_at)
values ('member-oss-contribs', '0 5 * * 2', 'member_oss_contribs', now())
on conflict (name) do nothing;
