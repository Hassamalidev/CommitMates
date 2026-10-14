'use client';

import { errorsCopy } from '@/copy/errors';

import './globals.css';

/**
 * Last resort when the root layout itself fails. It must render its own <html>, and it
 * keeps to plain markup so it cannot fail the same way.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const copy = errorsCopy.failure;
  return (
    <html lang="en" data-theme="dark">
      <body className="flex min-h-dvh items-center justify-center bg-canvas p-4 text-fg">
        <main role="alert" className="max-w-reading text-center">
          <h1 className="type-h2">{copy.title}</h1>
          <p className="type-body mt-2 text-fg-muted">
            {error.digest ? `${copy.line} ${copy.reference(error.digest)}` : copy.line}
          </p>
          <button
            type="button"
            onClick={reset}
            className="mt-6 inline-flex min-h-11 items-center rounded-control bg-accent px-4 font-semibold text-accent-ink"
          >
            {copy.retry}
          </button>
        </main>
      </body>
    </html>
  );
}
