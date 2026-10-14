import { listRoles } from '@commitmates/core';
import { Input } from '@commitmates/ui';
import type { Metadata } from 'next';

import { DataTable } from '@/components/admin/DataTable';
import { ActionForm } from '@/components/forms/ActionForm';
import { adminCopy } from '@/copy/admin';
import { formatUtc } from '@/lib/format';
import { adminRoleAction } from '@/server/actions/roles';
import { moderatorAction } from '@/server/actions/universities';
import { requireAdminPage } from '@/server/guards';

export function generateMetadata(): Metadata {
  return { title: adminCopy.roles.metaTitle, robots: { index: false } };
}

const copy = adminCopy.roles;
const sectionTitle = 'type-h3 mt-8 mb-3';

/** Role grants (CLAUDE.md §5.11): admins and university moderators, with grant and revoke forms. */
export default async function AdminRolesPage() {
  const admin = await requireAdminPage();
  const grants = await listRoles(admin);
  const moderators = adminCopy.universities.moderators;

  return (
    <>
      <h1 className="type-h1">{copy.title}</h1>
      <p className="type-body mt-2 max-w-reading text-fg-muted">{copy.intro}</p>

      <DataTable
        caption={copy.title}
        empty={adminCopy.none}
        rows={grants}
        rowKey={(row) => `${row.userId}:${row.role}:${row.universityId ?? ''}`}
        columns={[
          { header: copy.columns.member, cell: (row) => (row.login ? `@${row.login}` : adminCopy.none) },
          { header: copy.columns.role, cell: (row) => copy.roleNames[row.role] ?? row.role },
          { header: copy.columns.scope, cell: (row) => row.universityName ?? copy.everywhere },
          { header: copy.columns.since, cell: (row) => formatUtc(row.grantedAt) },
          {
            header: copy.columns.action,
            cell: (row) =>
              row.login === null || row.userId === admin.id ? null : row.role === 'admin' ? (
                <ActionForm
                  action={adminRoleAction}
                  values={{ login: row.login, grant: 'false' }}
                  submitLabel={copy.revoke(row.login)}
                  successMessage={copy.revoked}
                  variant="danger"
                />
              ) : (
                <ActionForm
                  action={moderatorAction}
                  values={{ login: row.login, universityId: row.universityId ?? '', grant: 'false' }}
                  submitLabel={copy.revoke(row.login)}
                  successMessage={copy.revoked}
                  variant="danger"
                />
              ),
          },
        ]}
      />

      <h2 className={sectionTitle}>{copy.adminTitle}</h2>
      <ActionForm
        action={adminRoleAction}
        values={{ grant: 'true' }}
        submitLabel={copy.grantAdmin}
        successMessage={copy.granted}
        variant="primary"
        className="flex max-w-reading flex-col gap-2"
      >
        <Input name="login" label={copy.adminLogin} required />
      </ActionForm>

      <h2 className={sectionTitle}>{moderators.title}</h2>
      <p className="type-small mb-3 max-w-reading text-fg-muted">{moderators.intro}</p>
      <ActionForm
        action={moderatorAction}
        values={{ grant: 'true' }}
        submitLabel={moderators.grant}
        successMessage={moderators.granted}
        variant="primary"
        className="flex max-w-reading flex-col gap-2"
      >
        <Input name="login" label={moderators.login} required />
        <Input name="universitySlug" label={moderators.university} required />
      </ActionForm>
    </>
  );
}
