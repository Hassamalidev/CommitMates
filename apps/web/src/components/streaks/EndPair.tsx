'use client';

import { Button, Dialog } from '@commitmates/ui';
import { useActionState, useState } from 'react';

import { streaksCopy } from '@/copy/streaks';
import { endPairAction } from '@/server/actions/streaks';

/** Ends a pair after a confirmation, because it cannot be undone. */
export function EndPair({ pairId }: { pairId: string }) {
  const copy = streaksCopy.pair;
  const [confirming, setConfirming] = useState(false);
  const [result, action, pending] = useActionState(endPairAction, null);
  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => {
          setConfirming(true);
        }}
      >
        {copy.end}
      </Button>
      {confirming ? (
        <Dialog open onOpenChange={setConfirming} title={copy.end} description={copy.endConfirm} closeLabel={copy.cancel}>
          <form action={action} className="flex flex-wrap gap-2">
            <input type="hidden" name="pairId" value={pairId} />
            <Button type="submit" variant="danger" loading={pending}>
              {copy.end}
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
            {result && !result.ok ? (
              <p role="alert" className="type-small w-full text-state-error">
                {result.error.message}
              </p>
            ) : null}
          </form>
        </Dialog>
      ) : null}
    </>
  );
}
