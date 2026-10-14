import { getHealth } from '@commitmates/core';
import { Icon } from '@commitmates/ui';
import type { Metadata } from 'next';

import { DataTable } from '@/components/admin/DataTable';
import { adminCopy } from '@/copy/admin';
import { formatUtc } from '@/lib/format';

export function generateMetadata(): Metadata {
  return { title: adminCopy.health.metaTitle, robots: { index: false } };
}

const sectionTitle = 'type-h3 mt-8 mb-3';

export default async function AdminHealthPage() {
  const health = await getHealth();
  const copy = adminCopy.health;
  const percent = Math.min(100, (health.database.sizeMb / Math.max(health.database.budgetMb, 1)) * 100);

  return (
    <>
      <h1 className="type-h1">{copy.title}</h1>
      <p className="type-small text-fg-muted">{copy.generated(formatUtc(health.generatedAt) ?? '')}</p>

      <section aria-labelledby="alerts-title" className="mt-6">
        <h2 id="alerts-title" className="type-h3 mb-3">
          {adminCopy.alerts.title}
        </h2>
        {health.alerts.length === 0 ? (
          <p className="type-body flex items-center gap-2 text-state-done">
            <Icon name="check_circle" />
            {adminCopy.alerts.clear}
          </p>
        ) : (
          <ul role="alert" className="flex flex-col gap-2 rounded-control border border-state-error bg-surface p-3">
            {health.alerts.map((alert) => (
              <li key={`${alert.key}-${JSON.stringify(alert.values)}`} className="type-body flex items-start gap-2 text-state-error">
                <Icon name="warning" className="mt-1" />
                <span>{adminCopy.alerts.messages[alert.key](alert.values)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <h2 className={sectionTitle}>{copy.queue.title}</h2>
      <p className="type-small mb-2 text-fg-muted">{copy.queue.dead(health.queue.deadJobs, health.queue.deadWindowHours)}</p>
      <DataTable
        caption={copy.queue.title}
        empty={copy.queue.empty}
        rows={health.queue.depth}
        rowKey={(row) => `${row.type}-${row.status}`}
        columns={[
          { header: copy.queue.columns.type, cell: (row) => <code className="type-code">{row.type}</code> },
          { header: copy.queue.columns.status, cell: (row) => row.status },
          { header: copy.queue.columns.count, cell: (row) => row.count, numeric: true },
        ]}
      />
      <h3 className="type-small mt-4 mb-2 font-semibold">{copy.queue.oldestTitle}</h3>
      <DataTable
        caption={copy.queue.oldestTitle}
        empty={copy.queue.oldestEmpty}
        rows={health.queue.oldest}
        rowKey={(row) => String(row.priority)}
        columns={[
          { header: copy.queue.oldestColumns.priority, cell: (row) => row.priority, numeric: true },
          { header: copy.queue.oldestColumns.count, cell: (row) => row.count, numeric: true },
          { header: copy.queue.oldestColumns.since, cell: (row) => formatUtc(row.oldestRunAt) },
        ]}
      />

      <h2 className={sectionTitle}>{copy.budgets.title}</h2>
      <DataTable
        caption={copy.budgets.title}
        empty={copy.budgets.empty}
        rows={health.budgets}
        rowKey={(row) => `${row.tokenIdentity}-${row.resource}`}
        columns={[
          // Member identities are shown by kind only; ids stay out of the page.
          { header: copy.budgets.columns.identity, cell: (row) => (row.tokenIdentity === 'server' ? 'server' : 'member') },
          { header: copy.budgets.columns.resource, cell: (row) => row.resource },
          { header: copy.budgets.columns.remaining, cell: (row) => row.remaining ?? adminCopy.none, numeric: true },
          { header: copy.budgets.columns.limit, cell: (row) => row.limit ?? adminCopy.none, numeric: true },
          { header: copy.budgets.columns.reset, cell: (row) => formatUtc(row.resetAt) ?? adminCopy.none },
        ]}
      />

      <h2 className={sectionTitle}>{copy.sources.title}</h2>
      <DataTable
        caption={copy.sources.title}
        empty={copy.sources.empty}
        rows={health.sources}
        rowKey={(row) => row.source}
        columns={[
          { header: copy.sources.columns.source, cell: (row) => row.source },
          { header: copy.sources.columns.items, cell: (row) => row.itemCount, numeric: true },
          { header: copy.sources.columns.skipped, cell: (row) => row.skippedCount, numeric: true },
          { header: copy.sources.columns.fetched, cell: (row) => formatUtc(row.fetchedAt) ?? adminCopy.never },
          { header: copy.sources.columns.error, cell: (row) => row.lastError ?? adminCopy.none },
        ]}
      />

      <h2 className={sectionTitle}>{copy.database.title}</h2>
      <div
        role="progressbar"
        aria-label={copy.database.label}
        aria-valuemin={0}
        aria-valuemax={health.database.budgetMb}
        aria-valuenow={Math.round(health.database.sizeMb)}
        aria-valuetext={copy.database.size(health.database.sizeMb, health.database.budgetMb)}
        className="h-3 max-w-reading overflow-hidden rounded-full border border-line bg-surface-2"
      >
        <div className="h-full bg-accent" style={{ width: `${percent}%` }} />
      </div>
      <p className="type-small mt-2 text-fg-muted">{copy.database.size(health.database.sizeMb, health.database.budgetMb)}</p>

      <h2 className={sectionTitle}>{copy.stale.title}</h2>
      <DataTable
        caption={copy.stale.title}
        empty={copy.stale.empty}
        rows={health.staleSettings}
        rowKey={(row) => row.key}
        columns={[
          { header: copy.stale.columns.key, cell: (row) => <code className="type-code">{row.key}</code> },
          { header: copy.stale.columns.computed, cell: (row) => formatUtc(row.computedAt) },
        ]}
      />
    </>
  );
}
