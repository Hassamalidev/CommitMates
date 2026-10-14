import {
  getUniversity,
  hasRole,
  listModeratorGrants,
  listReviewableRequests,
  type ModeratorRow,
  type PendingRequest,
} from '@commitmates/core';
import { Input, Select } from '@commitmates/ui';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { DataTable } from '@/components/admin/DataTable';
import { ActionForm } from '@/components/forms/ActionForm';
import { adminCopy } from '@/copy/admin';
import { formatUtc } from '@/lib/format';
import { moderatorAction, reviewRequestAction } from '@/server/actions/universities';
import { getCurrentMember } from '@/server/auth';

export function generateMetadata(): Metadata {
  return { title: adminCopy.universities.metaTitle, robots: { index: false } };
}

const copy = adminCopy.universities;
const sectionTitle = 'type-h3 mt-8 mb-3';

/**
 * University requests and moderators (CLAUDE.md §8 F10 step 6, §5.11). Admins see every open
 * request and manage moderators; a moderator sees requests from their universities' countries.
 */
export default async function AdminUniversitiesPage() {
  const member = await getCurrentMember();
  if (!member) notFound();
  const admin = hasRole(member, 'admin');
  const moderated = (
    await Promise.all(
      member.roles.flatMap((role) =>
        role.role === 'uni_moderator' && role.universityId ? [getUniversity(role.universityId)] : [],
      ),
    )
  ).flatMap((university) => (university ? [university] : []));
  const [requests, moderators] = await Promise.all([
    listReviewableRequests(member),
    admin ? listModeratorGrants() : Promise.resolve<ModeratorRow[]>([]),
  ]);

  const review = (request: PendingRequest) => (
    <div className="flex min-w-72 flex-col gap-3">
      {admin ? (
        <ActionForm
          action={reviewRequestAction}
          values={{ requestId: request.id, decision: 'create' }}
          submitLabel={copy.requests.create}
          successMessage={copy.requests.done}
          className="flex flex-col gap-2"
        >
          <Input name="name" label={copy.requests.createName} defaultValue={request.proposedName} required />
          <Input
            name="countryCode"
            label={copy.requests.createCountry}
            defaultValue={request.countryCode}
            maxLength={2}
            required
          />
        </ActionForm>
      ) : null}
      <ActionForm
        action={reviewRequestAction}
        values={{ requestId: request.id, decision: 'attach' }}
        submitLabel={copy.requests.attach}
        successMessage={copy.requests.done}
        className="flex flex-col gap-2"
      >
        {admin ? (
          <Input name="universitySlug" label={copy.requests.attachSlug} required />
        ) : (
          <Select
            name="universityId"
            label={copy.requests.attachUniversity}
            options={moderated.map((university) => ({ value: university.id, label: university.name }))}
          />
        )}
      </ActionForm>
      <ActionForm
        action={reviewRequestAction}
        values={{ requestId: request.id, decision: 'reject' }}
        submitLabel={copy.requests.reject}
        successMessage={copy.requests.done}
        variant="danger"
        className="flex flex-col gap-2"
      >
        <Input name="note" label={copy.requests.rejectNote} maxLength={500} />
      </ActionForm>
    </div>
  );

  return (
    <>
      <h1 className="type-h1">{copy.title}</h1>
      <p className="type-body mt-2 max-w-reading text-fg-muted">{admin ? copy.intro : copy.moderatorIntro}</p>

      <h2 className={sectionTitle}>{copy.requests.title}</h2>
      <DataTable
        caption={copy.requests.title}
        empty={copy.requests.empty}
        rows={requests}
        rowKey={(row) => row.id}
        columns={[
          {
            header: copy.requests.columns.domain,
            cell: (row) => <code className="type-code">{row.domain}</code>,
          },
          { header: copy.requests.columns.name, cell: (row) => row.proposedName },
          { header: copy.requests.columns.country, cell: (row) => row.countryCode },
          {
            header: copy.requests.columns.by,
            cell: (row) => (row.requesterLogin ? `@${row.requesterLogin}` : adminCopy.none),
          },
          { header: copy.requests.columns.when, cell: (row) => formatUtc(row.createdAt) },
          { header: copy.requests.columns.review, cell: review },
        ]}
      />

      {admin ? (
        <>
          <h2 className={sectionTitle}>{copy.moderators.title}</h2>
          <p className="type-small mb-3 max-w-reading text-fg-muted">{copy.moderators.intro}</p>
          <ActionForm
            action={moderatorAction}
            values={{ grant: 'true' }}
            submitLabel={copy.moderators.grant}
            successMessage={copy.moderators.granted}
            variant="primary"
            className="mb-4 flex max-w-reading flex-col gap-2"
          >
            <Input name="login" label={copy.moderators.login} required />
            <Input name="universitySlug" label={copy.moderators.university} required />
          </ActionForm>
          <DataTable
            caption={copy.moderators.title}
            empty={copy.moderators.empty}
            rows={moderators}
            rowKey={(row) => `${row.userId}:${row.universityId}`}
            columns={[
              {
                header: copy.moderators.columns.login,
                cell: (row) => (row.login ? `@${row.login}` : adminCopy.none),
              },
              { header: copy.moderators.columns.university, cell: (row) => row.universityName },
              { header: copy.moderators.columns.since, cell: (row) => formatUtc(row.grantedAt) },
              {
                header: copy.moderators.columns.action,
                cell: (row) => (
                  <ActionForm
                    action={moderatorAction}
                    values={{ login: row.login ?? '', universityId: row.universityId, grant: 'false' }}
                    submitLabel={`${copy.moderators.revoke} @${row.login ?? ''}`}
                    successMessage={copy.moderators.revoked}
                    variant="danger"
                  />
                ),
              },
            ]}
          />
        </>
      ) : null}
    </>
  );
}
