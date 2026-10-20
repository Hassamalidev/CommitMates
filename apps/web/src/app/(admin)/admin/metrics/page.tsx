import { METRIC_WINDOWS, getSocialMetrics, getToolMetrics, type ToolMetrics } from '@commitmates/core';
import { Card } from '@commitmates/ui';
import type { Metadata } from 'next';

import { DataTable } from '@/components/admin/DataTable';
import { adminCopy } from '@/copy/admin';
import { requireAdminPage } from '@/server/guards';

export function generateMetadata(): Metadata {
  return { title: adminCopy.metrics.metaTitle, robots: { index: false } };
}

const copy = adminCopy.metrics;
const sectionTitle = 'type-h3 mt-8 mb-3';
const percent = (share: number) => `${(share * 100).toFixed(1)}%`;

export default async function AdminMetricsPage() {
  await requireAdminPage();
  const [metrics, social]: [ToolMetrics, Awaited<ReturnType<typeof getSocialMetrics>>] = await Promise.all([getToolMetrics(), getSocialMetrics()]);
  const { conversion } = metrics;
  const { matchQuality, streaks } = social;

  return (
    <>
      <h1 className="type-h1">{copy.title}</h1>
      <p className="type-body mt-2 max-w-reading text-fg-muted">{copy.intro}</p>

      <h2 className={sectionTitle}>{copy.conversion.title}</h2>
      <Card className="flex max-w-reading flex-col gap-2">
        <p className="type-small text-fg-muted">{copy.conversion.line(METRIC_WINDOWS.totalDays)}</p>
        <p className="type-h2" data-testid="tool-conversion">
          {conversion.rate === null ? copy.conversion.none : copy.conversion.value(conversion.converted, conversion.sessions, percent(conversion.rate))}
        </p>
        <p className="type-small text-fg-muted">{copy.conversion.note}</p>
      </Card>

      <h2 className={sectionTitle}>{copy.usage.title}</h2>
      <DataTable
        caption={copy.usage.caption}
        empty={adminCopy.none}
        rows={metrics.usage}
        rowKey={(row) => row.tool}
        columns={[
          { header: copy.usage.columns.tool, cell: (row) => <code className="type-code">{row.tool}</code> },
          { header: copy.usage.columns.recent(METRIC_WINDOWS.recentDays), cell: (row) => row.recent, numeric: true },
          { header: copy.usage.columns.total(METRIC_WINDOWS.totalDays), cell: (row) => row.total, numeric: true },
        ]}
      />

      <h2 className={sectionTitle}>{copy.fairness.title}</h2>
      <DataTable
        caption={copy.fairness.caption}
        empty={adminCopy.none}
        rows={metrics.fairnessWeekly}
        rowKey={(row) => row.weekStart}
        columns={[
          { header: copy.fairness.columns.week, cell: (row) => row.weekStart },
          { header: copy.fairness.columns.reports, cell: (row) => row.count, numeric: true },
        ]}
      />

      <h2 className={sectionTitle}>{copy.matchQuality.title}</h2>
      <Card className="flex max-w-reading flex-col gap-2">
        <p className="type-small text-fg-muted">{copy.matchQuality.line(METRIC_WINDOWS.totalDays, matchQuality.messages, matchQuality.days)}</p>
        <p className="type-h2" data-testid="match-quality">
          {matchQuality.rate === null
            ? copy.matchQuality.none
            : copy.matchQuality.value(matchQuality.successful, matchQuality.accepted, percent(matchQuality.rate))}
        </p>
      </Card>

      <h2 className={sectionTitle}>{copy.streakRetention.title}</h2>
      <Card className="flex max-w-reading flex-col gap-2">
        <p className="type-small text-fg-muted">{copy.streakRetention.line}</p>
        <p className="type-h2" data-testid="streak-retention">
          {streaks.medianDays === null ? copy.streakRetention.none : copy.streakRetention.value(streaks.medianDays, streaks.activePairs)}
        </p>
      </Card>

      <p className="type-small mt-8 max-w-reading text-fg-muted">{copy.later}</p>
    </>
  );
}
