import { readAuditLog } from '@commitmates/core';
import { Button, Input, Select } from '@commitmates/ui';
import type { Metadata } from 'next';
import Link from 'next/link';

import { DataTable } from '@/components/admin/DataTable';
import { adminCopy } from '@/copy/admin';
import { formatUtc } from '@/lib/format';
import { requireAdminPage } from '@/server/guards';

export function generateMetadata(): Metadata {
  return { title: adminCopy.audit.metaTitle, robots: { index: false } };
}

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const copy = adminCopy.audit;
const first = (value: string | string[] | undefined) => (typeof value === 'string' ? value : undefined);

/** The audit log (CLAUDE.md §5.11): every admin and moderator action, newest first, 50 at a time. */
export default async function AdminAuditPage({ searchParams }: Props) {
  const admin = await requireAdminPage();
  const params = await searchParams;
  const action = first(params.action) ?? '';
  const targetType = first(params.targetType) ?? '';
  const log = await readAuditLog(admin, { action, targetType, before: first(params.before) });
  const olderHref =
    log.next === null
      ? null
      : `/admin/audit?${new URLSearchParams({ action, targetType, before: String(log.next) }).toString()}`;

  return (
    <>
      <h1 className="type-h1">{copy.title}</h1>
      <p className="type-body mt-2 max-w-reading text-fg-muted">{copy.intro}</p>

      <form method="get" className="my-6 flex flex-col gap-3 sm:flex-row sm:items-end">
        <Input name="action" label={copy.filter.action} defaultValue={action} className="flex-1" />
        <Select
          name="targetType"
          label={copy.filter.targetType}
          defaultValue={targetType}
          options={[
            { value: '', label: copy.filter.any },
            ...log.targetTypes.map((type) => ({ value: type, label: type })),
          ]}
        />
        <Button type="submit" variant="secondary" size="md">
          {copy.filter.apply}
        </Button>
      </form>

      <DataTable
        caption={copy.title}
        empty={copy.empty}
        rows={log.entries}
        rowKey={(row) => String(row.id)}
        columns={[
          { header: copy.columns.when, cell: (row) => formatUtc(row.createdAt) },
          {
            header: copy.columns.actor,
            cell: (row) =>
              row.actorLogin ? `@${row.actorLogin}` : row.actorUserId === null ? copy.system : adminCopy.none,
          },
          { header: copy.columns.action, cell: (row) => <code className="type-code">{row.action}</code> },
          {
            header: copy.columns.target,
            cell: (row) => <span className="break-all">{`${row.targetType} ${row.targetId}`}</span>,
          },
          {
            header: copy.columns.data,
            cell: (row) => <code className="type-code break-all">{JSON.stringify(row.data)}</code>,
          },
        ]}
      />
      {olderHref ? (
        <p className="mt-4">
          <Link href={olderHref} className="type-body text-accent underline underline-offset-4">
            {copy.older}
          </Link>
        </p>
      ) : null}
    </>
  );
}
