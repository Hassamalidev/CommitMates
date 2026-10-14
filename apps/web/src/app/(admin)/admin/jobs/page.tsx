import { getJobsOverview, type JobsOverview } from '@commitmates/core';
import type { Metadata } from 'next';

import { DataTable, type Column } from '@/components/admin/DataTable';
import { ActionForm } from '@/components/forms/ActionForm';
import { adminCopy } from '@/copy/admin';
import { formatUtc } from '@/lib/format';
import { retryJobAction, toggleScheduleAction } from '@/server/actions/admin';

export function generateMetadata(): Metadata {
  return { title: adminCopy.jobs.metaTitle, robots: { index: false } };
}

type JobRow = JobsOverview['queued'][number];
const copy = adminCopy.jobs;
const sectionTitle = 'type-h3 mt-8 mb-3';

const baseColumns: Column<JobRow>[] = [
  { header: copy.columns.type, cell: (row) => <code className="type-code">{row.type}</code> },
  { header: copy.columns.attempts, cell: (row) => `${row.attempts} / ${row.maxAttempts}`, numeric: true },
  { header: copy.columns.runAt, cell: (row) => formatUtc(row.runAt) },
  { header: copy.columns.updated, cell: (row) => formatUtc(row.updatedAt) },
];
const errorColumn: Column<JobRow> = {
  header: copy.columns.error,
  cell: (row) => <span className="break-words">{row.lastError ?? adminCopy.none}</span>,
};
const retryColumn: Column<JobRow> = {
  header: copy.columns.action,
  cell: (row) => (
    <ActionForm action={retryJobAction} values={{ jobId: row.id }} submitLabel={copy.retry} successMessage={copy.retried} />
  ),
};

export default async function AdminJobsPage() {
  const overview = await getJobsOverview();

  return (
    <>
      <h1 className="type-h1">{copy.title}</h1>

      <h2 className={sectionTitle}>{copy.schedules.title}</h2>
      <DataTable
        caption={copy.schedules.title}
        empty={adminCopy.none}
        rows={overview.schedules}
        rowKey={(row) => row.name}
        columns={[
          { header: copy.schedules.columns.name, cell: (row) => row.name },
          { header: copy.schedules.columns.cron, cell: (row) => <code className="type-code">{row.cronExpr}</code> },
          { header: copy.schedules.columns.type, cell: (row) => <code className="type-code">{row.jobType}</code> },
          { header: copy.schedules.columns.next, cell: (row) => formatUtc(row.nextRunAt) },
          { header: copy.schedules.columns.last, cell: (row) => formatUtc(row.lastRunAt) ?? adminCopy.never },
          {
            header: copy.schedules.columns.state,
            cell: (row) => (
              <div className="flex flex-wrap items-center gap-2">
                <span>{row.enabled ? copy.schedules.enabled : copy.schedules.disabled}</span>
                <ActionForm
                  action={toggleScheduleAction}
                  values={{ name: row.name, enabled: String(!row.enabled) }}
                  submitLabel={`${row.enabled ? copy.schedules.disable : copy.schedules.enable} ${row.name}`}
                />
              </div>
            ),
          },
        ]}
      />

      <h2 className={sectionTitle}>{copy.lists.dead.title}</h2>
      <DataTable
        caption={copy.lists.dead.title}
        empty={copy.lists.dead.empty}
        rows={overview.dead}
        rowKey={(row) => row.id}
        columns={[...baseColumns, errorColumn, retryColumn]}
      />

      <h2 className={sectionTitle}>{copy.lists.failed.title}</h2>
      <DataTable
        caption={copy.lists.failed.title}
        empty={copy.lists.failed.empty}
        rows={overview.failed}
        rowKey={(row) => row.id}
        columns={[...baseColumns, errorColumn, retryColumn]}
      />

      <h2 className={sectionTitle}>{copy.lists.running.title}</h2>
      <DataTable
        caption={copy.lists.running.title}
        empty={copy.lists.running.empty}
        rows={overview.running}
        rowKey={(row) => row.id}
        columns={baseColumns}
      />

      <h2 className={sectionTitle}>{copy.lists.queued.title}</h2>
      <DataTable
        caption={copy.lists.queued.title}
        empty={copy.lists.queued.empty}
        rows={overview.queued}
        rowKey={(row) => row.id}
        columns={[...baseColumns, errorColumn]}
      />
    </>
  );
}
