import { ThemeToggle } from '@commitmates/ui';
import type { Metadata } from 'next';
import Link from 'next/link';

import { AuthStatus } from '@/components/auth/AuthStatus';
import { siteCopy } from '@/copy/site';
import { themeCopy } from '@/copy/theme';
import { siteName } from '@/lib/site';

export function generateMetadata(): Metadata {
  return { title: { absolute: `${siteName} — ${siteCopy.home.title}` } };
}

// The sign-in state is per visitor.
export const dynamic = 'force-dynamic';

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-reading flex-col justify-center gap-4 px-4 py-16">
      <p className="type-eyebrow text-fg-muted">{siteCopy.home.eyebrow}</p>
      <h1 className="type-display">{siteCopy.home.title}</h1>
      <p className="type-body text-fg-muted">{siteCopy.tagline}</p>
      <AuthStatus />
      <p>
        <Link className="text-accent underline underline-offset-4" href="/health">
          {siteCopy.home.statusLink}
        </Link>
      </p>
      <ThemeToggle labels={themeCopy.labels} actionLabel={themeCopy.action} className="self-start" />
    </main>
  );
}
