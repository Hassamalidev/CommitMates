'use client';

import { Button, Dialog } from '@commitmates/ui';
import { useActionState, useState } from 'react';

import { safetyCopy } from '@/copy/safety';
import { blockAction } from '@/server/actions/safety';

import { ReportDialog } from './ReportDialog';

export type SafetyActionsProps = {
  userId: string;
  login: string;
  /** Whether the viewer has already blocked this member. */
  blocked: boolean;
  detailsMax: number;
};

/** Block (confirmed), Unblock and Report for another member (CLAUDE.md §8 F12). */
export function SafetyActions({ userId, login, blocked, detailsMax }: SafetyActionsProps) {
  const copy = safetyCopy;
  const [blockResult, block, blocking] = useActionState(blockAction, null);
  const [confirming, setConfirming] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [reported, setReported] = useState(false);

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap gap-2">
        {blocked ? (
          <form action={block}>
            <input type="hidden" name="userId" value={userId} />
            <Button type="submit" name="intent" value="unblock" size="sm" variant="secondary" loading={blocking}>
              {copy.block.unblock}
            </Button>
          </form>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setConfirming(true);
            }}
          >
            {copy.block.button}
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            setReporting(true);
          }}
        >
          {copy.report.button}
        </Button>
      </div>
      <p role="status" className="type-small text-state-done">
        {reported ? copy.report.done : blockResult?.ok ? (blocked ? copy.block.done(login) : copy.block.undone(login)) : ''}
      </p>
      {blockResult && !blockResult.ok ? (
        <p role="alert" className="type-small text-state-error">
          {blockResult.error.message}
        </p>
      ) : null}
      {confirming ? (
        <Dialog open onOpenChange={setConfirming} title={copy.block.title(login)} description={copy.block.line} closeLabel={copy.block.cancel}>
          <form
            action={(formData) => {
              setConfirming(false);
              block(formData);
            }}
            className="flex flex-wrap gap-2"
          >
            <input type="hidden" name="userId" value={userId} />
            <Button type="submit" name="intent" value="block" variant="danger">
              {copy.block.confirm}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setConfirming(false);
              }}
            >
              {copy.block.cancel}
            </Button>
          </form>
        </Dialog>
      ) : null}
      {reporting ? (
        <ReportDialog
          targetUserId={userId}
          login={login}
          detailsMax={detailsMax}
          onClose={() => {
            setReporting(false);
          }}
          onSent={() => {
            setReporting(false);
            setReported(true);
          }}
        />
      ) : null}
    </div>
  );
}
