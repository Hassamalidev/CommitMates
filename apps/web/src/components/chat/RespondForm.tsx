'use client';

import { Button } from '@commitmates/ui';
import { useActionState } from 'react';

import { chatCopy } from '@/copy/chat';
import { respondToRequestAction } from '@/server/actions/chat';

/**
 * Accept or Decline as one native form (works without JavaScript); accepting opens the
 * conversation, declining removes the request from the list without telling the sender.
 */
export function RespondForm({ requestId, login }: { requestId: string; login: string }) {
  const [result, action, pending] = useActionState(respondToRequestAction, null);
  const copy = chatCopy.inbox;
  return (
    <form action={action} className="flex flex-col gap-1">
      <input type="hidden" name="requestId" value={requestId} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" name="intent" value="accept" size="sm" disabled={pending} aria-label={copy.acceptLabel(login)}>
          {copy.accept}
        </Button>
        <Button type="submit" name="intent" value="decline" size="sm" variant="ghost" disabled={pending} aria-label={copy.declineLabel(login)}>
          {copy.decline}
        </Button>
      </div>
      {result && !result.ok ? (
        <p role="alert" className="type-small text-state-error">
          {result.error.message}
        </p>
      ) : null}
    </form>
  );
}
