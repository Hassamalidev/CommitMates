# Back up the database and restore it

When to use: weekly backups of production, before any risky migration (CLAUDE.md §13 item 4), and a restore drill once a quarter or after changing this procedure.

Prerequisites:

- Node and `pnpm install` at the repository root, which provides the Supabase CLI and `tsx`.
- Docker running: the Supabase CLI runs `pg_dump` in a container, so no local PostgreSQL install is needed.
- The database's **direct** connection string (Supabase dashboard → **Connect** → *Direct connection* or *Session pooler*). Do not use the transaction pooler. Treat the string as a secret.
- For a restore: `psql` 17 or newer. Install it with the PostgreSQL client tools, or run it from Docker: `docker run --rm -i postgres:17 psql …`.

What a backup holds: one gzip file of SQL with the schema (ours and Supabase's `auth` data), all rows, and our exact access rights. It is the full personal data of every member. Store it encrypted, away from this machine and from Supabase, keep only as many as you need, and delete old ones. A member's deletion request covers backups too: an old backup must not be restored without re-applying deletions made since.

## Steps

### Back up

1. Run:

   ```bash
   BACKUP_DATABASE_URL='postgresql://postgres.<ref>:<password>@<host>:5432/postgres' pnpm db:backup
   ```

   Without `BACKUP_DATABASE_URL` it uses `DIRECT_DATABASE_URL` from the environment or `.env.local` (the local stack during development). The URL is never printed.

2. The script writes `backups/<UTC timestamp>.sql.gz` (`backups/` is ignored by git) in this order:
   1. the schema, from `supabase db dump`;
   2. `SET session_replication_role = replica`, so rows load table by table without triggers or foreign-key checks, as Supabase's restore guide does;
   3. the data, from `supabase db dump --data-only --use-copy`;
   4. the access rights of the public schema, from `scripts/db-privileges.ts`.

   Roles are not dumped: the app defines none, and every Supabase project has its own.

3. Move the file to encrypted storage you control, then delete the local copy.

Why the access-rights section exists: Supabase's dump writes grants but never revokes. A new project's default privileges grant the browser roles everything, so without this section a restore silently reopens the rights the migrations removed. Those are `EXECUTE` on `take_token` and our trigger functions (0002, 0070, ADR-010) and `UPDATE`/`DELETE` on `credit_ledger` (0053). The first drill below found exactly this.

### Restore

Restore into an **empty** Supabase database: a new project, the staging project after a reset, or the local stack after `npx supabase db reset`. Never restore over a database you still need.

1. Point `TARGET_DATABASE_URL` at the target's direct connection.
2. Run the whole file in one transaction, stopping at the first error, so a failed restore leaves nothing half-done:

   ```bash
   gunzip -c backups/<file>.sql.gz | psql "$TARGET_DATABASE_URL" --single-transaction -v ON_ERROR_STOP=1 -q
   ```

   Locally: `gunzip -c backups/<file>.sql.gz | docker exec -i supabase_db_commitmates psql -U postgres -d postgres --single-transaction -v ON_ERROR_STOP=1 -q`.

3. Run `pnpm db:migrate` against the target. It should report nothing new to apply, because the migration journal (`drizzle.__drizzle_migrations`) is part of the backup.
4. In staging or production, re-create what lives outside the database: the Vault secrets `tick_url` and `tick_secret`, and the pg_cron tick from `docs/runbooks/deploy.md`. Then check `/admin/health`.

### Restore drill

1. On the source, record a snapshot. Save the two queries below as `counts.sql` and `acl.sql`, run them with `psql -At`, and keep the output.

   ```sql
   -- counts.sql: rows in every table that must come back
   select table_schema || '.' || table_name || ' ' ||
          (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', table_schema, table_name), false, true, '')))[1]::text
   from information_schema.tables
   where table_schema in ('public', 'auth', 'drizzle') and table_type = 'BASE TABLE' order by 1;
   ```

   ```sql
   -- acl.sql: access rights, default privileges, the Realtime publication, policies and RLS
   select 'acl ' || c.oid::regclass::text || ' ' || coalesce(c.relacl::text, '-') from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r','p','v','m','S') order by 1;
   select 'acl ' || p.oid::regprocedure::text || ' ' || coalesce(p.proacl::text, '-') from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e') order by 1;
   select 'default ' || defaclrole::regrole::text || ' ' || defaclobjtype::text || ' ' || defaclacl::text from pg_default_acl where defaclnamespace = 'public'::regnamespace order by 1;
   select 'publication ' || tablename from pg_publication_tables where pubname = 'supabase_realtime' order by 1;
   select 'policy ' || tablename || ' ' || policyname || ' ' || qual from pg_policies where schemaname = 'public' order by 1;
   select 'rls-off ' || tablename from pg_tables where schemaname = 'public' and not rowsecurity order by 1;
   ```

2. Back up, then restore into an empty target as above.
3. Run the same queries on the target and `diff` the two outputs. They must be identical.
4. Run the e2e smoke specs against the target (`e2e/health.spec.ts`, `e2e/auth.spec.ts`, `e2e/privacy-center.spec.ts`).

## Verify it worked

- The restore exits 0 with nothing rolled back.
- The snapshot diff is empty.
- `pnpm db:migrate` has nothing to apply.
- `/admin/health` shows no alerts beyond those expected for a fresh environment.

## Roll back

A restore runs in one transaction, so a failed restore changes nothing. If a restore succeeded into the wrong database, restore that database's own latest backup the same way.

## Drill record

**2026-11-04, local stack** (Supabase CLI 2.120.0, PostgreSQL 17.11). The source held 121 tables in `public`, `auth` and `drizzle`, with 4,086 auth audit rows, 665 tool sessions, 356 jobs, 285 audit-log entries and 187 messages. The target was the same stack after `npx supabase db reset`: a fresh Supabase database, with migrations and seeding disabled, so none of our schema.

1. **First attempt: failed safely.** The file then began with Supabase's role settings (`ALTER ROLE … SET`, `GRANT SET ON PARAMETER log_min_messages`), which the `postgres` role may not change. The single transaction rolled back. Roles were removed from the backup.
2. **Second attempt: restored, but found a real gap.** It restored in 2 s and all 121 row counts matched, but `anon` could again execute `take_token` and `set_updated_at` and update `credit_ledger`: the dump carries no revokes, and the new database's defaults re-granted them. The access-rights section (`scripts/db-privileges.ts`) was added, and the three revokes were re-applied to the development database.
3. **Final cycle, with the script as committed.**
   - Backup: 16 s, 356 KB.
   - Restore: 4 s, exit 0.
   - The snapshot diff (236 lines: 121 row counts, every ACL, 6 default-privilege rows, the publication, the policies and RLS) was empty.
   - `pnpm db:migrate` had nothing to apply.
   - `anon` could neither run `take_token` or `set_updated_at` nor update `credit_ledger`.
   - The smoke specs passed (16 tests).
