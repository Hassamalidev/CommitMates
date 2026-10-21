-- Verified Skill Swap (CLAUDE.md §8 F16).
insert into settings (key, value_type, default_value, min_sample, unit, description) values
  ('swap.selfDeclaredFactor', 'number', '0.5'::jsonb, 0, 'factor', 'Weight of an edge whose offer is self-declared rather than verified from code'),
  ('swap.maxPriority', 'integer', '3'::jsonb, 0, 'level', 'Highest priority a member can give a skill they want to learn'),
  ('swap.goalPriority', 'integer', '2'::jsonb, 0, 'level', 'Priority of a learning goal the member has not ranked on the Skill Swap page'),
  ('swap.proposalTtlDays', 'integer', '7'::jsonb, 0, 'days', 'Days a swap proposal waits for every member to answer'),
  ('swap.maxSelfDeclared', 'integer', '10'::jsonb, 0, 'tags', 'Self-declared skills a member can offer'),
  ('swap.maxWants', 'integer', '10'::jsonb, 0, 'tags', 'Skills a member can ask to learn on the Skill Swap page')
on conflict (key) do nothing;
--> statement-breakpoint
insert into job_schedules (name, cron_expr, job_type, next_run_at)
values ('propose-swaps', '30 3 * * *', 'propose_swaps', now())
on conflict (name) do nothing;
