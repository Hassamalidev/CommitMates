'use client';

import { Button, CompanionView, EmptyState, buttonStyles } from '@commitmates/ui';

import { errorsCopy } from '@/copy/errors';
import { brandCompanion } from '@/lib/brand';

/** Shown when a page throws while rendering. The digest lets us find the log entry. */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const copy = errorsCopy.failure;
  return (
    <main className="flex min-h-dvh items-center justify-center">
      <div role="alert">
        <h1 className="sr-only">{copy.title}</h1>
        <EmptyState
          companion={<CompanionView companion={brandCompanion} state="error" size={160} label={copy.companionLabel} />}
          title={copy.title}
          description={error.digest ? `${copy.line} ${copy.reference(error.digest)}` : copy.line}
          action={
            <div className="flex flex-wrap justify-center gap-3">
              <Button onClick={reset}>{copy.retry}</Button>
              <a href="/" className={buttonStyles({ variant: 'secondary' })}>
                {copy.home}
              </a>
            </div>
          }
        />
      </div>
    </main>
  );
}
