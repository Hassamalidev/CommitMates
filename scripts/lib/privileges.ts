/**
 * Rebuilds the access rights of a schema after a restore (docs/runbooks/backup-restore.md).
 *
 * Supabase's dump writes grants but never revokes. Restored into a new project, whose default
 * privileges grant the browser roles everything, a revoked right (such as EXECUTE on our functions,
 * migration 0070) would quietly come back. These statements first revoke from every role that could
 * hold a right, then grant exactly what the source database had.
 */

export type Grant = { grantee: string; privilege: string };

/** One object's rights as read from the source; names and grantees arrive already quoted by Postgres. */
export type ObjectAcl = { kind: 'TABLE' | 'SEQUENCE' | 'FUNCTION'; name: string; grants: Grant[] };

/** Default rights for objects a role creates later in the schema. */
export type DefaultAcl = { owner: string; objectType: 'TABLES' | 'SEQUENCES' | 'FUNCTIONS' | 'TYPES' | 'SCHEMAS'; grants: Grant[] };

/** One GRANT per grantee, listing all of its privileges. */
function grantLines(grants: readonly Grant[], grantStatement: (privileges: string, grantee: string) => string): string[] {
  const byGrantee = new Map<string, string[]>();
  for (const grant of grants) byGrantee.set(grant.grantee, [...(byGrantee.get(grant.grantee) ?? []), grant.privilege]);
  return [...byGrantee].map(([grantee, privileges]) => grantStatement(privileges.join(', '), grantee));
}

/**
 * The SQL that gives every listed object, and the schema's default privileges, the same rights as
 * the source. `roles` are the roles to revoke from first (PUBLIC is always included).
 */
export function privilegeStatements(schema: string, objects: readonly ObjectAcl[], defaults: readonly DefaultAcl[], roles: readonly string[]): string[] {
  const from = ['PUBLIC', ...roles.filter((role) => role !== 'PUBLIC')].join(', ');
  const statements: string[] = [];
  for (const object of objects) {
    const target = `${object.kind} ${object.name}`;
    statements.push(`REVOKE ALL ON ${target} FROM ${from};`);
    statements.push(...grantLines(object.grants, (privileges, grantee) => `GRANT ${privileges} ON ${target} TO ${grantee};`));
  }
  for (const entry of defaults) {
    const scope = `ALTER DEFAULT PRIVILEGES FOR ROLE ${entry.owner} IN SCHEMA ${schema}`;
    statements.push(`${scope} REVOKE ALL ON ${entry.objectType} FROM ${from};`);
    statements.push(...grantLines(entry.grants, (privileges, grantee) => `${scope} GRANT ${privileges} ON ${entry.objectType} TO ${grantee};`));
  }
  return statements;
}
