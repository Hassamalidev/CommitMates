import { attributionSources } from '@commitmates/core';
import type { Metadata } from 'next';

import { ProsePage } from '@/components/layout/Prose';
import { LEGAL_UPDATED, legalCopy, type Credit } from '@/copy/legal';
import dependencies from '@/generated/dependency-licenses.json' with { type: 'json' };
import { formatCalendarDate } from '@/lib/dev-card';

export function generateMetadata(): Metadata {
  return { title: legalCopy.attribution.metaTitle, description: legalCopy.attribution.intro };
}

function CreditCard({ credit, note }: { credit: Credit; note?: string | undefined }) {
  return (
    <li className="rounded-control border border-line bg-surface p-3">
      <a
        href={credit.href}
        rel="noreferrer"
        className="type-body inline-flex min-h-11 items-center font-semibold text-accent underline underline-offset-4 sm:min-h-0"
      >
        {credit.name}
      </a>
      <p className="type-small text-fg-muted">{credit.use}</p>
      <p className="type-small text-fg-muted">
        {legalCopy.attribution.licenseLabel}: {credit.license}
      </p>
      {note ? <p className="type-small text-fg-muted">{note}</p> : null}
    </li>
  );
}

/**
 * Credits generated from what the app uses (CLAUDE.md §6.11): the synced sources with their last
 * sync from `source_snapshots`, and every shipped package from the dependency license report.
 */
export default async function AttributionPage() {
  const copy = legalCopy.attribution;
  const sources = await attributionSources();
  return (
    <ProsePage title={copy.title} intro={copy.intro} updated={LEGAL_UPDATED}>
      <section className="mt-8">
        <h2 className="type-h3">{copy.dataTitle}</h2>
        <ul className="mt-3 flex flex-col gap-3">
          {copy.data.map((credit) => (
            <CreditCard key={credit.name} credit={credit} />
          ))}
          {sources.map((source) => (
            <CreditCard
              key={source.name}
              credit={copy.synced[source.name]}
              note={source.syncedAt ? copy.syncedOn(formatCalendarDate(source.syncedAt.toISOString().slice(0, 10))) : copy.notSynced}
            />
          ))}
        </ul>
      </section>
      <section className="mt-8">
        <h2 className="type-h3">{copy.assetsTitle}</h2>
        <ul className="mt-3 flex flex-col gap-3">
          {copy.assets.map((credit) => (
            <CreditCard key={credit.name} credit={credit} />
          ))}
        </ul>
      </section>
      <p className="type-body mt-4 text-fg-muted">{copy.companions}</p>
      <section className="mt-8">
        <h2 className="type-h3">{copy.softwareTitle}</h2>
        <p className="type-body mt-3 text-fg-muted">{copy.softwareLine(dependencies.length)}</p>
        <table className="type-small mt-3 w-full table-fixed border-collapse">
          <caption className="sr-only">{copy.softwareCaption}</caption>
          <thead>
            <tr className="border-b border-line text-left text-fg-muted">
              <th scope="col" className="py-2 pr-3 font-semibold">
                {copy.packageHeading}
              </th>
              <th scope="col" className="w-1/3 py-2 font-semibold">
                {copy.licenseLabel}
              </th>
            </tr>
          </thead>
          <tbody>
            {dependencies.map((dependency) => (
              <tr key={dependency.name} className="border-b border-line">
                <td className="py-1.5 pr-3 break-words">
                  <a href={dependency.homepage} rel="noreferrer" className="text-accent underline underline-offset-4">
                    {dependency.name}
                  </a>
                </td>
                <td className="py-1.5 break-words text-fg-muted">{dependency.license}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </ProsePage>
  );
}
