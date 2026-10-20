'use client';

import { Button } from '@commitmates/ui';
import { useActionState } from 'react';

import { streaksCopy } from '@/copy/streaks';
import { respondPairInviteAction } from '@/server/actions/streaks';

/** Accept or Decline a streak invitation as one native form (works without JavaScript). */
export function InviteResponse({ inviteId, login }: { inviteId: string; login: string }) {
  const [result, action, pending] = useActionState(respondPairInviteAction, null);
  const copy = streaksCopy;
  return (
    <form action={action} className="flex flex-col gap-1">
      <input type="hidden" name="inviteId" value={inviteId} />
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
