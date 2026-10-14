import { getSettingHistory, listSettings } from '@commitmates/core';
import { Input } from '@commitmates/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { DataTable } from '@/components/admin/DataTable';
import { ActionForm } from '@/components/forms/ActionForm';
import { adminCopy } from '@/copy/admin';
import { formatUtc, previewJson } from '@/lib/format';
import { overrideSettingAction } from '@/server/actions/admin';
import { requireAdminPage } from '@/server/guards';

type Props = { params: Promise<{ key: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { key } = await params;
  return { title: `${decodeURIComponent(key)} · ${adminCopy.settings.metaTitle}`, robots: { index: false } };
}

export default async function AdminSettingPage({ params }: Props) {
  await requireAdminPage();
  const copy = adminCopy.settings.detail;
  const key = decodeURIComponent((await params).key);
  const setting = (await listSettings()).find((row) => row.key === key);
  if (!setting) notFound();
  const history = await getSettingHistory(key);

  const facts: [string, string][] = [
    [copy.type, setting.valueType],
    [copy.unit, setting.unit ?? adminCopy.none],
    [copy.default, JSON.stringify(setting.defaultValue)],
    [copy.computed, setting.computedValue === null ? adminCopy.none : JSON.stringify(setting.computedValue)],
    [copy.override, setting.overrideValue === null ? adminCopy.none : JSON.stringify(setting.overrideValue)],
  ];

  return (
    <>
      <p>
        <Link href="/admin/settings" className="type-small inline-flex min-h-11 items-center text-accent underline underline-offset-4">
          {copy.back}
        </Link>
      </p>
      <h1 className="type-h2 break-all font-mono">{setting.key}</h1>
      <p className="type-body mt-2 max-w-reading text-fg-muted">{setting.description}</p>

      <dl className="type-small mt-6 grid max-w-reading grid-cols-[auto_1fr] gap-x-6 gap-y-2">
        {facts.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="font-semibold">{label}</dt>
            <dd>
              <code className="type-code break-all">{value}</code>
            </dd>
          </div>
        ))}
      </dl>

      <ActionForm
        action={overrideSettingAction}
        values={{ key: setting.key }}
        submitLabel={copy.save}
        successMessage={copy.saved}
        variant="primary"
        size="md"
        className="mt-6 flex max-w-reading flex-col gap-3"
      >
        <Input
          label={copy.valueLabel}
          description={copy.valueHelp}
          name="value"
          defaultValue={setting.overrideValue === null ? '' : JSON.stringify(setting.overrideValue)}
          autoComplete="off"
          spellCheck={false}
        />
      </ActionForm>

      <h2 className="type-h3 mt-8 mb-3">{copy.historyTitle}</h2>
      <DataTable
        caption={copy.historyTitle}
        empty={copy.historyEmpty}
        rows={history}
        rowKey={(row) => String(row.id)}
        columns={[
          { header: copy.historyColumns.when, cell: (row) => formatUtc(row.createdAt) },
          { header: copy.historyColumns.field, cell: (row) => row.field },
          { header: copy.historyColumns.from, cell: (row) => <code className="type-code break-all">{previewJson(row.oldValue)}</code> },
          { header: copy.historyColumns.to, cell: (row) => <code className="type-code break-all">{previewJson(row.newValue)}</code> },
          { header: copy.historyColumns.source, cell: (row) => row.source },
        ]}
      />
    </>
  );
}
