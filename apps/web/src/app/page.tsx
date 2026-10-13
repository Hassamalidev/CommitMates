import type { Metadata } from 'next';
import Link from 'next/link';

import { AuthStatus } from '@/components/auth/AuthStatus';
import { siteCopy } from '@/copy/site';
import { siteName } from '@/lib/site';

export function generateMetadata(): Metadata {
  return { title: { absolute: `${siteName} — ${siteCopy.home.title}` } };
}

// The sign-in state is per visitor.
export const dynamic = 'force-dynamic';

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center gap-4 px-4 py-16">
      <p className="text-sm tracking-widest uppercase">{siteCopy.home.eyebrow}</p>
      <h1 className="text-4xl font-medium">{siteCopy.home.title}</h1>
      <p className="text-base">{siteCopy.tagline}</p>
      <AuthStatus />
      <p>
        <Link className="underline underline-offset-4" href="/health">
          {siteCopy.home.statusLink}
        </Link>
      </p>
    </main>
  );
}
