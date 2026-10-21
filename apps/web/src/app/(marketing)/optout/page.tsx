import { Card, Input } from '@commitmates/ui';
import type { Metadata } from 'next';

import { ActionForm } from '@/components/forms/ActionForm';
import { optoutCopy } from '@/copy/optout';
import { optOutAction } from '@/server/actions/optout';

export const metadata: Metadata = { title: optoutCopy.meta.title, description: optoutCopy.meta.description };

/** The country index opt-out (CLAUDE.md §8 F18 "Privacy", §6.11 footer). */
export default function OptOutPage() {
  const copy = optoutCopy;
  return (
    <div className="mx-auto flex max-w-reading flex-col gap-6 px-4 py-10">
      <header>
        <p className="type-eyebrow text-fg-muted">{copy.eyebrow}</p>
        <h1 className="type-h1 mt-1">{copy.title}</h1>
      </header>
      {copy.intro.map((paragraph) => (
        <p key={paragraph} className="type-body">
          {paragraph}
        </p>
      ))}
      <Card>
        <ActionForm action={optOutAction} submitLabel={copy.submit} successMessage={copy.done} variant="primary" className="flex flex-col items-start gap-3">
          <Input label={copy.label} name="login" required autoComplete="off" description={copy.help} />
        </ActionForm>
      </Card>
    </div>
  );
}
