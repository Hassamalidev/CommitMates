import postgres from 'postgres';
import { z } from 'zod';

import { privilegeStatements, type DefaultAcl, type ObjectAcl } from './lib/privileges';

/**
 * Prints SQL that restores the access rights of the public schema exactly as they are in the given
 * database. `scripts/db-backup.sh` appends it to every backup (docs/runbooks/backup-restore.md).
 * Usage: tsx scripts/db-privileges.ts <database-url>
 */

/** The schema the browser roles reach through Supabase's API; its rights are what matters. */
const SCHEMA = 'public';
/** Supabase's API roles: a new project's default privileges grant them rights, so they are always revoked first. */
const API_ROLES = ['anon', 'authenticated', 'service_role'];

const grantsSchema = z.array(z.object({ grantee: z.string(), privilege: z.string() }));
const objectSchema = z.object({ kind: z.enum(['TABLE', 'SEQUENCE', 'FUNCTION']), name: z.string(), grants: grantsSchema });
const defaultSchema = z.object({ owner: z.string(), objectType: z.enum(['TABLES', 'SEQUENCES', 'FUNCTIONS', 'TYPES', 'SCHEMAS']), grants: grantsSchema });

const url = process.argv[2];
if (!url) {
  console.error('Usage: tsx scripts/db-privileges.ts <database-url>');
  process.exit(1);
}

const sql = postgres(url, { prepare: false, max: 1, onnotice: () => undefined });
try {
  // Names print schema-qualified and quoted where needed.
  await sql`select set_config('search_path', '', false)`;
  const objects = await sql`
    with objects as (
      select case c.relkind when 'S' then 'SEQUENCE' else 'TABLE' end as kind, c.oid::regclass::text as name,
             c.relacl as acl, c.relowner as owner, c.oid, 'pg_class'::regclass as classid
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = ${SCHEMA} and c.relkind in ('r', 'p', 'v', 'm', 'S')
      union all
      select 'FUNCTION', p.oid::regprocedure::text, p.proacl, p.proowner, p.oid, 'pg_proc'::regclass
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = ${SCHEMA}
    )
    select o.kind, o.name,
           coalesce((select json_agg(json_build_object(
                       'grantee', case a.grantee when 0 then 'PUBLIC' else a.grantee::regrole::text end,
                       'privilege', a.privilege_type) order by a.grantee, a.privilege_type)
                     from aclexplode(o.acl) a where a.grantee <> o.owner), '[]'::json) as grants
    from objects o
    -- A null ACL means the built-in defaults, and extensions recreate their own objects.
    where o.acl is not null
      and not exists (select 1 from pg_depend d where d.classid = o.classid and d.objid = o.oid and d.deptype = 'e')
    order by o.kind, o.name`;
  const defaults = await sql`
    select case d.defaclobjtype when 'r' then 'TABLES' when 'S' then 'SEQUENCES' when 'f' then 'FUNCTIONS'
                                when 'T' then 'TYPES' else 'SCHEMAS' end as "objectType",
           d.defaclrole::regrole::text as owner,
           coalesce((select json_agg(json_build_object(
                       'grantee', case a.grantee when 0 then 'PUBLIC' else a.grantee::regrole::text end,
                       'privilege', a.privilege_type) order by a.grantee, a.privilege_type)
                     from aclexplode(d.defaclacl) a where a.grantee <> d.defaclrole), '[]'::json) as grants
    from pg_default_acl d
    where d.defaclnamespace = ${SCHEMA}::regnamespace and d.defaclrole = current_user::regrole
    order by 1`;
  const roles = await sql<{ name: string }[]>`select rolname::regrole::text as name from pg_roles where rolname in ${sql(API_ROLES)} order by 1`;

  const statements = privilegeStatements(
    SCHEMA,
    z.array(objectSchema).parse(objects) satisfies ObjectAcl[],
    z.array(defaultSchema).parse(defaults) satisfies DefaultAcl[],
    roles.map((role) => role.name),
  );
  process.stdout.write(`-- Access rights of the ${SCHEMA} schema as in the source database.\n${statements.join('\n')}\n`);
} finally {
  await sql.end();
}
