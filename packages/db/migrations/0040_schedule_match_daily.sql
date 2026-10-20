-- Nightly decks for every university where matching is unlocked (CLAUDE.md §8 F11 "Deck").
insert into job_schedules (name, cron_expr, job_type, next_run_at)
values ('match-daily', '30 2 * * *', 'match_daily', now())
on conflict (name) do nothing;
