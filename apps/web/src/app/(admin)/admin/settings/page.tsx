import { listSettings } from '@commitmates/core';
import { Button, Input } from '@commitmates/ui';
import type { Metadata } from 'next';
import Link from 'next/link';

import { DataTable } from '@/components/admin/DataTable';
import { adminCopy } from '@/copy/admin';
import { previewJson } from '@/lib/format';

export function generateMetadata(): Metadata {
  return { title: adminCopy.settings.metaTitle, robots: { index: false } };
}

/** Longest filter text accepted from the URL. */
const MAX_FILTER_CHARS = 80;

export default async function AdminSettingsPage({ searchParams }: { searchParams: Promise<{ q?: string | string[] }> }) {
  const copy = adminCopy.settings;
  const { q } = await searchParams;
  const filter = (typeof q === 'string' ? q : '').trim().toLowerCase().slice(0, MAX_FILTER_CHARS);
  const all = await listSettings();
  const shown = filter === '' ? all : all.filter((setting) => setting.key.toLowerCase().includes(filter));

  return (
    <>
      <h1 className="type-h1">{copy.title}</h1>
      <p className="type-body mt-2 max-w-reading text-fg-muted">{copy.intro}</p>

      <form method="get" className="mt-6 flex max-w-reading flex-wrap items-end gap-3">
        <Input label={copy.filterLabel} name="q" defaultValue={filter} className="min-w-0 flex-1" />
        <Button type="submit" variant="secondary">
          {copy.filterAction}
        </Button>
      </form>
      <p className="type-small mt-3 mb-3 text-fg-muted" role="status">
        {copy.count(shown.length, all.length)}
      </p>

      <DataTable
        caption={copy.title}
        empty={adminCopy.none}
        rows={shown}
        rowKey={(row) => row.key}
        columns={[
          {
            header: copy.columns.key,
            cell: (row) => (
              <>
                <Link
                  href={`/admin/settings/${encodeURIComponent(row.key)}`}
                  className="type-code inline-flex min-h-11 items-center text-accent underline underline-offset-4 sm:min-h-0"
                >
                  {row.key}
                </Link>
                <p className="text-fg-muted">{row.description}</p>
              </>
            ),
          },
          {
            header: copy.columns.value,
            cell: (row) => (
              <code className="type-code break-all">
                {previewJson(row.value)}
                {row.unit ? ` ${row.unit}` : ''}
              </code>
            ),
          },
          { header: copy.columns.source, cell: (row) => copy.sources[row.source] },
          { header: copy.columns.samples, cell: (row) => copy.samples(row.sampleSize, row.minSample) },
        ]}
      />
    </>
  );
}
