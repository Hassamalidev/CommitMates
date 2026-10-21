'use client';

import { Button, Dialog, Textarea } from '@commitmates/ui';
import { useActionState, useState } from 'react';

import { graveyardCopy } from '@/copy/graveyard';
import type { ActionResult } from '@/server/action';
import { requestAdoptionAction } from '@/server/actions/adoptions';

export type AdoptDialogProps = { listingId: string; fullName: string; ownerLogin: string };

/**
 * "Adopt" on a university listing (CLAUDE.md §8 F14 "Adoption flow" step 1): a first message to the
 * owner, sent as a message request with the adoption as its context. The chat rules apply on the server.
 */
export function AdoptDialog({ listingId, fullName, ownerLogin }: AdoptDialogProps) {
  const copy = graveyardCopy.adopt;
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState(false);
  const [result, action, pending] = useActionState(async (previous: ActionResult<null> | null, formData: FormData) => {
    const outcome = await requestAdoptionAction(previous, formData);
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
        {copy.sent(ownerLogin)}
      </p>
    );
  }
  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button variant="primary" size="sm" aria-label={copy.triggerLabel(fullName)}>
          {copy.trigger}
        </Button>
      }
      title={copy.title(fullName)}
      description={copy.line(ownerLogin)}
      closeLabel={copy.close}
    >
      <form action={action} className="flex flex-col gap-3">
        <input type="hidden" name="listingId" value={listingId} />
        <Textarea
          label={copy.message}
          name="message"
          rows={4}
          required
          description={copy.messageHelp}
          error={error?.field === 'message' ? error.message : undefined}
        />
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
