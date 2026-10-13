import type { Metadata } from 'next';

import { healthCopy } from '@/copy/health';
import { getAppVersion } from '@/lib/version';

// Server time must be read per request, never at build time.
export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: healthCopy.metaTitle, robots: { index: false } };
}

export default function HealthPage() {
  const { version, commit } = getAppVersion();
  const now = new Date().toISOString();

  return (
    <main className="mx-auto max-w-reading px-4 py-16">
      <h1 className="type-h1">{healthCopy.title}</h1>
      <p className="type-body mt-2 text-fg-muted">{healthCopy.intro}</p>
      <dl className="mt-8 grid grid-cols-[auto_1fr] gap-x-6 gap-y-3">
        <dt className="font-semibold">{healthCopy.status.label}</dt>
        <dd data-testid="health-status">{healthCopy.status.ok}</dd>
        <dt className="font-semibold">{healthCopy.version}</dt>
        <dd data-testid="health-version">{version}</dd>
        <dt className="font-semibold">{healthCopy.commit.label}</dt>
        <dd>{commit ?? healthCopy.commit.unknown}</dd>
        <dt className="font-semibold">{healthCopy.serverTime}</dt>
        <dd>
          <time dateTime={now}>{now}</time>
        </dd>
      </dl>
    </main>
  );
}
