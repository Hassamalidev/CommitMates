-- Functions, triggers and policies that Drizzle's schema files cannot express.

-- A member row lives and dies with its Supabase auth user (CLAUDE.md §7.1).
alter table users
  add constraint users_id_auth_users_fk foreign key (id) references auth.users (id) on delete cascade;
--> statement-breakpoint

create or replace function set_updated_at() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end $$;
--> statement-breakpoint
create trigger users_set_updated_at before update on users
  for each row execute function set_updated_at();
--> statement-breakpoint
create trigger github_identities_set_updated_at before update on github_identities
  for each row execute function set_updated_at();
--> statement-breakpoint
create trigger profiles_set_updated_at before update on profiles
  for each row execute function set_updated_at();
--> statement-breakpoint
create trigger jobs_set_updated_at before update on jobs
  for each row execute function set_updated_at();
--> statement-breakpoint
create trigger settings_set_updated_at before update on settings
  for each row execute function set_updated_at();
--> statement-breakpoint
create trigger source_snapshots_set_updated_at before update on source_snapshots
  for each row execute function set_updated_at();
--> statement-breakpoint
create trigger notification_prefs_set_updated_at before update on notification_prefs
  for each row execute function set_updated_at();
--> statement-breakpoint

-- Token bucket (CLAUDE.md §5.10). Refills by elapsed time, then takes `p_cost` tokens if available.
create or replace function take_token(
  p_key text, p_capacity double precision, p_refill_per_sec double precision, p_cost double precision default 1)
returns boolean
language plpgsql
set search_path = public
as $$
declare v_tokens double precision; v_now timestamptz := clock_timestamp();
begin
  insert into rate_limit_buckets(key, tokens, updated_at) values (p_key, p_capacity, v_now)
  on conflict (key) do update set
    tokens = least(p_capacity,
      rate_limit_buckets.tokens + extract(epoch from (v_now - rate_limit_buckets.updated_at)) * p_refill_per_sec),
    updated_at = v_now
  returning tokens into v_tokens;
  if v_tokens >= p_cost then
    update rate_limit_buckets set tokens = tokens - p_cost where key = p_key;
    return true;
  end if;
  return false;
end $$;
--> statement-breakpoint
-- Only server code may spend tokens.
revoke execute on function take_token(text, double precision, double precision, double precision) from public, anon, authenticated;
--> statement-breakpoint

-- The single row that paces every geocoder call (CLAUDE.md §6.8).
insert into geocoder_lock (id) values (1) on conflict (id) do nothing;
--> statement-breakpoint

-- Row Level Security (CLAUDE.md §5.9). Every table has RLS enabled by the migration that
-- creates it. Tables the browser never reads get no policy, which denies `anon` and
-- `authenticated`. Members may read their own notifications through Supabase Realtime.
create policy notifications_select on notifications for select to authenticated
  using (user_id = auth.uid());
