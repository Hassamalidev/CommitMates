'use client';

import { Button, Dialog, Textarea } from '@commitmates/ui';
import { useActionState, useState } from 'react';

import { discoverCopy } from '@/copy/discover';
import type { ActionResult } from '@/server/action';
import { requestFromSuggestionAction } from '@/server/actions/discover';

export type RequestDialogProps = {
  suggestionId: string;
  login: string;
  limits: { min: number; max: number };
  onClose: () => void;
  onSent: (login: string) => void;
};

/**
 * The first message of a chat request (CLAUDE.md §8 F12 "Message requests" step 1): the person
 * sees it before deciding, so it has to say something. Errors from the request rules show inline.
 */
export function RequestDialog({ suggestionId, login, limits, onClose, onSent }: RequestDialogProps) {
  const [message, setMessage] = useState('');
  const [result, action, pending] = useActionState(async (previous: ActionResult<null> | null, formData: FormData) => {
    const outcome = await requestFromSuggestionAction(previous, formData);
    if (outcome.ok) onSent(login);
    return outcome;
  }, null);
  const copy = discoverCopy.request;
  const error = result && !result.ok ? result.error : null;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={copy.title(login)}
      description={copy.description}
      closeLabel={copy.close}
    >
      <form action={action} className="flex flex-col gap-3">
        <input type="hidden" name="suggestionId" value={suggestionId} />
        <Textarea
          label={copy.label}
          name="message"
          required
          minLength={limits.min}
          maxLength={limits.max}
          rows={5}
          value={message}
          onChange={(event) => {
            setMessage(event.target.value);
          }}
          description={copy.help(limits.min, limits.max)}
          error={error?.field === 'message' ? error.message : undefined}
        />
        <p className="type-small self-end text-fg-muted">
          {copy.counter(message.trim().length, limits.max)}
        </p>
        {error && error.field !== 'message' ? (
          <p role="alert" className="type-small text-state-error">
            {error.message}
          </p>
        ) : null}
        <Button type="submit" loading={pending} className="self-start">
          {copy.submit}
        </Button>
      </form>
    </Dialog>
  );
}
