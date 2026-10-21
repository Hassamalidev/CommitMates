'use client';

import { Button, Dialog, Textarea } from '@commitmates/ui';
import { useActionState, useState } from 'react';

import { chatCopy } from '@/copy/chat';
import type { ActionResult } from '@/server/action';

export type AskDialogProps = {
  login: string;
  title: string;
  /** Hidden form values the action needs, such as the member and the context. */
  values: Readonly<Record<string, string>>;
  /** A first message filled from the context; the member can change it. */
  prefill: string;
  action: (previous: ActionResult<null> | null, formData: FormData) => Promise<ActionResult<null>>;
};

/**
 * "Ask @login" from a feature that found someone who can help (CLAUDE.md §8 F12 "Message requests"):
 * a first message, prefilled from the context, sent as a message request. Errors show inline.
 */
export function AskDialog({ login, title, values, prefill, action }: AskDialogProps) {
  const copy = chatCopy.ask;
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState(false);
  const [result, formAction, pending] = useActionState(async (previous: ActionResult<null> | null, formData: FormData) => {
    const outcome = await action(previous, formData);
    if (outcome.ok) {
      setSent(true);
      setOpen(false);
    }
    return outcome;
  }, null);
  const error = result && !result.ok ? result.error : null;
  if (sent) {
    return (
      <p role="status" className="type-small text-state-done">
        {copy.sent(login)}
      </p>
    );
  }
  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button variant="secondary" size="sm">
          {copy.trigger(login)}
        </Button>
      }
      title={title}
      description={copy.description}
      closeLabel={copy.close}
    >
      <form action={formAction} className="flex flex-col gap-3">
        {Object.entries(values).map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} />
        ))}
        <Textarea label={copy.message} name="message" rows={4} required defaultValue={prefill} error={error?.field === 'message' ? error.message : undefined} />
        {error && error.field !== 'message' ? (
          <p role="alert" className="type-small text-state-error">
            {error.message}
          </p>
        ) : null}
        <Button type="submit" variant="primary" loading={pending} className="self-start">
          {copy.submit}
        </Button>
      </form>
    </Dialog>
  );
}
