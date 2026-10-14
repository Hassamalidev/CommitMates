import type { Metadata } from 'next';

import { ProsePage } from '@/components/layout/Prose';
import { LEGAL_UPDATED, legalCopy } from '@/copy/legal';

export function generateMetadata(): Metadata {
  return { title: legalCopy.attribution.metaTitle, description: legalCopy.attribution.intro };
}

type Credit = { name: string; use: string; license: string; href: string };

function CreditList({ title, credits }: { title: string; credits: readonly Credit[] }) {
  return (
    <section className="mt-8">
      <h2 className="type-h3">{title}</h2>
      <ul className="mt-3 flex flex-col gap-3">
        {credits.map((credit) => (
          <li key={credit.name} className="rounded-control border border-line bg-surface p-3">
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
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function AttributionPage() {
  const copy = legalCopy.attribution;
  return (
    <ProsePage title={copy.title} intro={copy.intro} updated={LEGAL_UPDATED}>
      <CreditList title={copy.dataTitle} credits={copy.data} />
      <CreditList title={copy.assetsTitle} credits={copy.assets} />
      <p className="type-body mt-4 text-fg-muted">{copy.companions}</p>
      <section className="mt-8">
        <h2 className="type-h3">{copy.softwareTitle}</h2>
        <p className="type-body mt-3 text-fg-muted">{copy.softwareLine}</p>
      </section>
    </ProsePage>
  );
}
