import { getCrawlerOverview } from '@commitmates/core';
import { Card } from '@commitmates/ui';
import type { Metadata } from 'next';

import { DataTable } from '@/components/admin/DataTable';
import { adminCopy } from '@/copy/admin';
import { requireAdminPage } from '@/server/guards';

export function generateMetadata(): Metadata {
  return { title: adminCopy.crawler.metaTitle, robots: { index: false } };
}

const copy = adminCopy.crawler;
const ORDER = ['running', 'pending', 'splitting', 'done'] as const;

/** The country crawler's progress and the index's size against its limits (CLAUDE.md §8 F18 "Routes"). */
export default async function AdminCrawlerPage() {
  const member = await requireAdminPage();
  const overview = await getCrawlerOverview(member);
  const rows = ORDER.flatMap((status) => (overview.cursors[status] ? [{ status, count: overview.cursors[status] }] : []));

  return (
    <>
      <h1 className="type-h1">{copy.title}</h1>
      <p className="type-body mt-2 max-w-reading text-fg-muted">{copy.intro(overview.refreshDays, overview.searchCap)}</p>

      <h2 className="type-h3 mt-8 mb-3">{copy.storageTitle}</h2>
      <Card className="flex max-w-reading flex-col gap-1" data-testid="crawler-storage">
        <p className="type-body">{copy.users(overview.users, overview.limits.maxUsers)}</p>
        <p className="type-body">{copy.repos(overview.repos, overview.limits.maxRepos)}</p>
        <p className="type-small text-fg-muted">{copy.optouts(overview.optouts)}</p>
      </Card>

      <h2 className="type-h3 mt-8 mb-3">{copy.cursorsTitle}</h2>
      <p className="type-small mb-2 text-fg-muted">{copy.seeds(overview.seeds)}</p>
      <DataTable
        caption={copy.cursorsTitle}
        columns={[
          { header: copy.columns.status, cell: (row) => copy.status[row.status] ?? row.status },
          { header: copy.columns.count, cell: (row) => row.count.toLocaleString('en'), numeric: true },
        ]}
        rows={rows}
        rowKey={(row) => row.status}
        empty={copy.empty}
      />
    </>
  );
}
