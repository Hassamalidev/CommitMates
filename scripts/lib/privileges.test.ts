import { describe, expect, it } from 'vitest';

import { privilegeStatements } from './privileges';

describe('privilegeStatements', () => {
  it('revokes from every role that could hold a right, then grants exactly what the source had', () => {
    const statements = privilegeStatements(
      'public',
      [
        { kind: 'FUNCTION', name: 'public.set_updated_at()', grants: [{ grantee: 'service_role', privilege: 'EXECUTE' }] },
        {
          kind: 'TABLE',
          name: 'public.users',
          grants: [
            { grantee: 'anon', privilege: 'SELECT' },
            { grantee: 'anon', privilege: 'INSERT' },
            { grantee: 'service_role', privilege: 'SELECT' },
          ],
        },
      ],
      [{ owner: 'postgres', objectType: 'FUNCTIONS', grants: [] }],
      ['anon', 'authenticated', 'service_role'],
    );
    expect(statements).toEqual([
      'REVOKE ALL ON FUNCTION public.set_updated_at() FROM PUBLIC, anon, authenticated, service_role;',
      'GRANT EXECUTE ON FUNCTION public.set_updated_at() TO service_role;',
      'REVOKE ALL ON TABLE public.users FROM PUBLIC, anon, authenticated, service_role;',
      'GRANT SELECT, INSERT ON TABLE public.users TO anon;',
      'GRANT SELECT ON TABLE public.users TO service_role;',
      'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM PUBLIC, anon, authenticated, service_role;',
    ]);
  });

  it('grants PUBLIC back when the source granted it', () => {
    const statements = privilegeStatements('public', [{ kind: 'FUNCTION', name: 'public.f()', grants: [{ grantee: 'PUBLIC', privilege: 'EXECUTE' }] }], [], []);
    expect(statements).toEqual(['REVOKE ALL ON FUNCTION public.f() FROM PUBLIC;', 'GRANT EXECUTE ON FUNCTION public.f() TO PUBLIC;']);
  });
});
