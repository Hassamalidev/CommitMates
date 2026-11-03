-- Security review (CLAUDE.md §5.9, P7-T01b, ADR-010): the browser roles may call no function of the
-- public schema. Supabase exposes public functions as RPC endpoints, and functions are executable by
-- PUBLIC unless revoked. Trigger functions keep working: triggers do not check EXECUTE.
revoke execute on function set_updated_at() from public, anon, authenticated;
--> statement-breakpoint
revoke execute on function credit_ledger_append_only() from public, anon, authenticated;
--> statement-breakpoint
revoke execute on function immutable_array_to_string(text[], text) from public, anon, authenticated;
--> statement-breakpoint
-- Functions created later by the migration role are not executable by the browser roles either.
alter default privileges in schema public revoke execute on functions from public;
--> statement-breakpoint
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'alter default privileges in schema public revoke execute on functions from anon, authenticated';
  end if;
end $$;
