import { getSetting } from '@commitmates/core';
import { Card, Textarea } from '@commitmates/ui';
import type { Metadata } from 'next';

import { ActionForm } from '@/components/forms/ActionForm';
import { safetyCopy } from '@/copy/safety';
import { feedbackAction } from '@/server/actions/safety';

export function generateMetadata(): Metadata {
  return { title: safetyCopy.feedback.meta.title, robots: { index: false } };
}

type Props = { searchParams: Promise<{ about?: string | string[] }> };

/** Feedback, and appeals from members whose account is hidden for review (CLAUDE.md §8 F12). */
export default async function FeedbackPage({ searchParams }: Props) {
  const { about } = await searchParams;
  const appeal = about === 'appeal';
  const maxChars = await getSetting('feedback.maxChars');
  const copy = safetyCopy.feedback;
  return (
    <div className="mx-auto flex max-w-reading flex-col gap-6 px-4 py-10">
      <div>
        <h1 className="type-h1">{copy.title}</h1>
        <p className="type-body mt-2 text-fg-muted">{appeal ? copy.appealIntro : copy.intro}</p>
      </div>
      <Card>
        <ActionForm
          action={feedbackAction}
          values={{ page: appeal ? '/feedback?about=appeal' : '/feedback' }}
          submitLabel={copy.submit}
          successMessage={copy.done}
          variant="primary"
          size="md"
          className="flex flex-col gap-3"
        >
          <Textarea label={copy.label} name="body" required maxLength={maxChars} rows={6} description={copy.help(maxChars)} />
        </ActionForm>
      </Card>
    </div>
  );
}
