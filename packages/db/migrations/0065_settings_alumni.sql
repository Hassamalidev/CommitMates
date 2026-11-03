-- Alumni Quick Asks (CLAUDE.md §8 F20).
insert into settings (key, value_type, default_value, min_sample, unit, description) values
  ('alumni.questionMaxChars', 'integer', '600'::jsonb, 0, 'characters', 'Longest question a member can ask the alumni'),
  ('alumni.maxQuestionTags', 'integer', '8'::jsonb, 0, 'tags', 'Tags kept on a question, from its keyphrases and the asker''s picks'),
  ('alumni.responsivenessDays', 'integer', '90'::jsonb, 0, 'days', 'Window over which an alumnus'' answered share of routed questions is measured')
on conflict (key) do nothing;
--> statement-breakpoint
insert into job_schedules (name, cron_expr, job_type, next_run_at)
values ('role-transition', '30 1 * * *', 'role_transition', now()), ('alumni-sla', '20 * * * *', 'alumni_sla', now())
on conflict (name) do nothing;
