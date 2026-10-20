'use client';

import { Button, Dialog } from '@commitmates/ui';
import { useActionState, useState } from 'react';

import { chatCopy } from '@/copy/chat';
import { leaveThreadAction, muteThreadAction } from '@/server/actions/chat';

/** Mute (a native form) and Leave (confirmed in a dialog) for one conversation. */
export function ThreadActions({ threadId, muted }: { threadId: string; muted: boolean }) {
  const copy = chatCopy.conversation;
  const [, muteAction, muting] = useActionState(muteThreadAction, null);
  const [left, leaveAction, leaving] = useActionState(leaveThreadAction, null);
  const [confirming, setConfirming] = useState(false);
  return (
    <div className="flex flex-wrap gap-2">
      <form action={muteAction}>
        <input type="hidden" name="threadId" value={threadId} />
        <input type="hidden" name="muted" value={muted ? 'false' : 'true'} />
        <Button type="submit" size="sm" variant="secondary" loading={muting}>
          {muted ? copy.unmute : copy.mute}
        </Button>
      </form>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => {
          setConfirming(true);
        }}
      >
        {copy.leave}
      </Button>
      {confirming ? (
        <Dialog open onOpenChange={setConfirming} title={copy.leave} description={copy.leaveConfirm} closeLabel={copy.cancel}>
          <form action={leaveAction} className="flex flex-wrap gap-2">
            <input type="hidden" name="threadId" value={threadId} />
            <Button type="submit" variant="danger" loading={leaving}>
              {copy.leave}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setConfirming(false);
              }}
            >
              {copy.cancel}
            </Button>
            {left && !left.ok ? (
              <p role="alert" className="type-small w-full text-state-error">
                {left.error.message}
              </p>
            ) : null}
          </form>
        </Dialog>
      ) : null}
    </div>
  );
}
